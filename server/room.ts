import { DurableObject } from "cloudflare:workers";
import { BONUS, gameData, nextHintRank, roundAt, type Entry, type Lang } from "./data.ts";
import type { Env } from "./env.ts";

/**
 * One Durable Object per room. Everyone plays the word of the hour; the room records each
 * player's guesses itself, so it alone decides who found the word, in how many tries.
 */

const EXPIRY_MS = 30 * 24 * 3600 * 1000; // rooms vanish after 30 days without activity
/** Players with these names (case-insensitive) can remove anyone, in every room. */
const ADMINS = ["fred"];
const POINTS = [5, 3, 2]; // 1st, 2nd, 3rd to find; then 1; +1 without hints

export type RoomError = { error: "not_found" | "taken" | "bad_name" | "auth" | "unknown_word" | "finished" | "no_hint" | "locked" | "no_data" | "forbidden" | "not_given_up" | "kicked" | "no_bonus" };
export type Visibility = "public" | "private";
/** défi: everyone plays alone, words hidden; collab: one shared game, everyone sees every word. */
export type Mode = "defi" | "collab";

export interface PlayerRound {
  status: "playing" | "won" | "gaveup";
  tries: number;
  hints: number;
  best: number | null; // best rank
  finished: number | null;
  place: number | null; // order of finding, among winners
}

export interface Snapshot {
  code: string;
  name: string;
  visibility: Visibility;
  mode: Mode;
  level: string;
  owner: string | null; // display name of the creator, who can change the visibility
  admins: string[]; // display names of the players who can remove anyone
  round: number; // the round played right now: the word of the hour, or a bonus word
  bonus: number | null; // a bonus word is being played: the round of the hour it was launched in
  theme: string | null; // and its theme ("🍄 Mario")
  players: { name: string; online: boolean; now: PlayerRound | null; points: number; wins: number }[];
}

export interface PastRound {
  round: number;
  word: string | null;
  players: { name: string; status: PlayerRound["status"]; tries: number; hints: number; place: number | null }[];
  words: { word: string; rank: number; by: { name: string; n: number; hint: boolean }[] }[]; // closest first
  at: number; // last word proposed (pagination)
  bonus: number | null; // played as a bonus word during that round of the hour
  theme: string | null; // its theme
}

export interface RoomGuess extends Entry {
  n: number;
  hint: boolean;
  by?: string; // author, in collab mode
}

const nameKey = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("fr");

export class Room extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS players (key TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, joined INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS guesses (
        round INTEGER, player TEXT, id INTEGER, word TEXT, rank INTEGER, cos REAL, hint INTEGER, n INTEGER, at INTEGER,
        PRIMARY KEY (round, player, id));
      CREATE TABLE IF NOT EXISTS results (
        round INTEGER, player TEXT, status TEXT, tries INTEGER, hints INTEGER, best INTEGER, finished INTEGER,
        PRIMARY KEY (round, player));
      CREATE TABLE IF NOT EXISTS bonus (round INTEGER PRIMARY KEY, base INTEGER NOT NULL, at INTEGER NOT NULL);
    `);
  }

  // ------------------------------------------------------------------ helpers

  private meta(k: string): string | null {
    return (this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v) ?? null;
  }
  private setMeta(k: string, v: string) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }

  private async lang(): Promise<Lang | null> {
    const code = this.meta("lang");
    return code ? gameData(this.env.DATA).lang(code) : null;
  }

  /** The round played right now: a bonus word launched during this hour, otherwise the word of the hour. */
  private active(L: Lang): { round: number; bonus: number | null } {
    const hour = roundAt(L.meta);
    const b = this.sql.exec<{ round: number }>("SELECT round FROM bonus WHERE base = ? ORDER BY at DESC LIMIT 1", hour).toArray()[0];
    return b ? { round: b.round, bonus: hour } : { round: hour, bonus: null };
  }

  private player(token: string | undefined): { key: string; name: string } | null {
    if (!token) return null;
    return this.sql.exec<{ key: string; name: string }>("SELECT key, name FROM players WHERE token = ?", token).toArray()[0] ?? null;
  }

  private touch() {
    this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS);
  }

  private result(round: number, player: string): PlayerRound | null {
    const row = this.sql.exec<{ status: PlayerRound["status"]; tries: number; hints: number; best: number | null; finished: number | null }>(
      "SELECT status, tries, hints, best, finished FROM results WHERE round = ? AND player = ?", round, player).toArray()[0];
    if (!row) return null;
    let place: number | null = null;
    if (row.status === "won")
      place = this.sql.exec<{ c: number }>(
        "SELECT COUNT(*) AS c FROM results WHERE round = ? AND status = 'won' AND finished < ?", round, row.finished).one().c + 1;
    return { ...row, place };
  }

  private async snapshot(): Promise<Snapshot | null> {
    const L = await this.lang();
    if (!L) return null;
    const { round, bonus } = this.active(L);
    const points = new Map<string, number>();
    const wins = new Map<string, number>();
    let cur = -1, place = 0;
    for (const w of this.sql.exec<{ round: number; player: string; hints: number }>(
      "SELECT round, player, hints FROM results WHERE status = 'won' ORDER BY round, finished")) {
      if (w.round !== cur) { cur = w.round; place = 0; }
      const p = (POINTS[place++] ?? 1) + (w.hints === 0 ? 1 : 0);
      points.set(w.player, (points.get(w.player) ?? 0) + p);
      wins.set(w.player, (wins.get(w.player) ?? 0) + 1);
    }
    const players = this.sql.exec<{ key: string; name: string }>("SELECT key, name FROM players ORDER BY joined").toArray()
      .map((p) => ({
        name: p.name,
        online: this.ctx.getWebSockets(p.key).length > 0,
        now: this.result(round, p.key),
        points: points.get(p.key) ?? 0,
        wins: wins.get(p.key) ?? 0,
      }));
    const code = this.meta("code") ?? "";
    if (!this.meta("owner")) {
      // rooms created before owners existed: the earliest player owns it
      const first = this.sql.exec<{ key: string }>("SELECT key FROM players ORDER BY joined LIMIT 1").toArray()[0];
      if (first) this.setMeta("owner", first.key);
    }
    const ownerKey = this.meta("owner");
    const owner = ownerKey ? (this.sql.exec<{ name: string }>("SELECT name FROM players WHERE key = ?", ownerKey).toArray()[0]?.name ?? null) : null;
    const admins = players.filter((p) => ADMINS.includes(nameKey(p.name))).map((p) => p.name);
    return { code, name: this.meta("name") || `Room ${code}`, visibility: this.visibility(), mode: this.mode(), level: this.level(L), owner, admins, round, bonus, theme: bonus ? await this.themeOf(L, round) : null, players };
  }

  private async themeOf(L: Lang, round: number): Promise<string | null> {
    if (round <= BONUS) return null;
    const B = await gameData(this.env.DATA).bonus(L);
    return B?.themes[B.theme[round - BONUS - 1]] ?? null;
  }

  /** Rooms created before levels existed play the default (adult) level. */
  private level(L: Lang): string {
    return gameData(this.env.DATA).level(L, this.meta("level"));
  }

  private mode(): Mode {
    return this.meta("mode") === "collab" ? "collab" : "defi";
  }

  /** In collab mode: has anyone in the room found this round's word? */
  private teamWon(round: number): boolean {
    return this.sql.exec("SELECT 1 FROM results WHERE round = ? AND status = 'won' LIMIT 1", round).toArray().length > 0;
  }

  /** Every word proposed in the room this round (collab view), first proposal wins, with its author. */
  private teamGuesses(round: number): RoomGuess[] {
    const rows = this.sql.exec<{ id: number; word: string; rank: number; cos: number; hint: number; at: number; name: string }>(
      `SELECT g.id, g.word, g.rank, g.cos, g.hint, g.at, p.name FROM guesses g JOIN players p ON p.key = g.player
       WHERE g.round = ? ORDER BY g.at`, round).toArray();
    const seen = new Set<number>();
    const out: RoomGuess[] = [];
    for (const g of rows) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ id: g.id, word: g.word, rank: g.rank, cos: g.cos, hint: g.hint === 1, n: out.length + 1, by: g.name });
    }
    return out;
  }

  private visibility(): Visibility {
    return this.meta("visibility") === "public" ? "public" : "private";
  }

  private directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("directory"));
  }

  /** Keep the public directory in sync (public rooms only). */
  private async publish(snap: Snapshot) {
    const lang = this.meta("lang");
    if (!lang) return;
    try {
      if (snap.visibility !== "public") return await this.directory().remove(snap.code);
      await this.directory().upsert(lang, {
        code: snap.code, name: snap.name, round: snap.round, level: snap.level,
        players: snap.players.length,
        online: snap.players.filter((p) => p.online).length,
        found: snap.players.filter((p) => p.now?.status === "won").length,
        lastActive: Date.now(),
      });
    } catch {}
  }

  private async broadcast() {
    const snap = await this.snapshot();
    if (!snap) return;
    const msg = JSON.stringify({ type: "snapshot", snapshot: snap });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
    await this.publish(snap);
  }

  private send(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch {}
    }
  }

  private event(text: string) {
    const msg = JSON.stringify({ type: "event", text });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }

  // ------------------------------------------------------------------ RPC

  async create(code: string, lang: string, name = "", visibility: Visibility = "private", level = "adult"): Promise<boolean> {
    if (this.meta("lang")) return false;
    this.setMeta("level", level);
    this.setMeta("lang", lang);
    this.setMeta("code", code);
    this.setMeta("visibility", visibility === "public" ? "public" : "private");
    this.setMeta("name", name.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 30));
    this.setMeta("created", String(Date.now()));
    this.touch();
    return true;
  }

  async exists(): Promise<boolean> {
    return this.meta("lang") !== null;
  }

  async join(name: string, token?: string): Promise<{ token: string; name: string } | RoomError> {
    if (!this.meta("lang")) return { error: "not_found" };
    const clean = name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (clean.length < 1 || clean.length > 20) return { error: "bad_name" };
    const mine = this.player(token);
    if (mine) return { token: token!, name: mine.name }; // already in (maybe renamed from another device)
    if (token) return { error: "kicked" }; // my saved token is gone: the creator removed me
    const key = nameKey(clean);
    if (this.sql.exec("SELECT 1 FROM players WHERE key = ?", key).toArray().length) return { error: "taken" };
    const fresh = crypto.randomUUID();
    this.sql.exec("INSERT INTO players (key, name, token, joined) VALUES (?, ?, ?, ?)", key, clean, fresh, Date.now());
    if (!this.meta("owner")) this.setMeta("owner", key); // the creator joins first
    this.touch();
    await this.broadcast();
    this.event(`👋 ${clean} rejoint la room`);
    return { token: fresh, name: clean };
  }

  async state(): Promise<Snapshot | RoomError> {
    return (await this.snapshot()) ?? { error: "not_found" };
  }

  /** My guesses for a round, plus my status. */
  async mine(token: string, round?: number): Promise<{ round: number; guesses: RoomGuess[]; status: PlayerRound["status"] } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const n = round ?? this.active(L).round;
    if (this.mode() === "collab")
      return { round: n, guesses: this.teamGuesses(n), status: this.teamWon(n) ? "won" : this.result(n, me.key)?.status ?? "playing" };
    const guesses = this.sql.exec<{ id: number; word: string; rank: number; cos: number; hint: number; n: number }>(
      "SELECT id, word, rank, cos, hint, n FROM guesses WHERE round = ? AND player = ? ORDER BY n", n, me.key).toArray()
      .map((g) => ({ ...g, hint: g.hint === 1 }));
    return { round: n, guesses, status: this.result(n, me.key)?.status ?? "playing" };
  }

  private async record(token: string, pick: (L: Lang, ranks: number[]) => number | null | "unknown", hint: boolean): Promise<RoomGuess | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const round = this.active(L).round;
    const collab = this.mode() === "collab";
    const res = this.result(round, me.key);
    if (res?.status === "won" || (!collab && res && res.status !== "playing") || (collab && this.teamWon(round))) return { error: "finished" };
    const ranks = collab
      ? this.teamGuesses(round).map((g) => g.rank)
      : this.sql.exec<{ rank: number }>("SELECT rank FROM guesses WHERE round = ? AND player = ?", round, me.key).toArray().map((r) => r.rank);
    const r = await gameData(this.env.DATA).round(L, round, this.level(L));
    if (!r) return { error: "no_data" };
    const picked = pick(L, ranks);
    if (picked === "unknown") return { error: "unknown_word" };
    if (picked === null) return { error: "no_hint" };
    const id = hint ? r.order[picked] : picked;
    const e = gameData(this.env.DATA).entry(L, r, id);

    if (collab) {
      const already = this.teamGuesses(round).find((g) => g.id === id);
      if (already) return already;
    }
    const dup = this.sql.exec<{ n: number; hint: number }>("SELECT n, hint FROM guesses WHERE round = ? AND player = ? AND id = ?", round, me.key, id).toArray()[0];
    if (dup) return { ...e, n: dup.n, hint: dup.hint === 1 };

    const n = ranks.length + 1;
    this.sql.exec("INSERT INTO guesses (round, player, id, word, rank, cos, hint, n, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      round, me.key, id, e.word, e.rank, e.cos, hint ? 1 : 0, n, Date.now());
    const won = e.rank === 0;
    this.sql.exec(`
      INSERT INTO results (round, player, status, tries, hints, best, finished) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(round, player) DO UPDATE SET
        status = excluded.status, tries = tries + excluded.tries, hints = hints + excluded.hints,
        best = MIN(best, excluded.best), finished = excluded.finished`,
      round, me.key, won ? "won" : "playing", hint ? 0 : 1, hint ? 1 : 0, e.rank, won ? Date.now() : null);
    this.touch();
    const out: RoomGuess = collab
      ? { ...e, n: this.teamGuesses(round).length, hint, by: me.name }
      : { ...e, n, hint };
    if (collab) this.send({ type: "guess", round, guess: out }); // everyone sees the new word right away
    await this.broadcast();
    if (won) {
      if (collab) this.event(`🎯 ${me.name} a trouvé le mot pour toute l'équipe !`);
      else {
        const place = this.result(round, me.key)?.place ?? 1;
        this.event(place === 1 ? `🎯 ${me.name} a trouvé en premier !` : `🎯 ${me.name} a trouvé (${place}ᵉ)`);
      }
    }
    return out;
  }

  guess(token: string, word: string) {
    return this.record(token, (L) => L.index.get(word) ?? "unknown", false);
  }

  hint(token: string) {
    return this.record(token, (L, ranks) => nextHintRank(ranks, this.level(L)), true);
  }

  async giveUp(token: string): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const round = this.active(L).round;
    const res = this.result(round, me.key);
    if (res && res.status !== "playing") return { error: "finished" };
    this.sql.exec(`
      INSERT INTO results (round, player, status, tries, hints, best, finished) VALUES (?, ?, 'gaveup', 0, 0, NULL, ?)
      ON CONFLICT(round, player) DO UPDATE SET status = 'gaveup', finished = excluded.finished`, round, me.key, Date.now());
    await this.broadcast();
    this.event(`🏳️ ${me.name} abandonne`);
    return { ok: true };
  }

  /** Change my player name in this room (unique, case-insensitive). History and points follow. */
  async rename(token: string, name: string): Promise<{ token: string; name: string } | RoomError> {
    const me = this.player(token);
    if (!me) return { error: "auth" };
    const clean = name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (clean.length < 1 || clean.length > 20) return { error: "bad_name" };
    const key = nameKey(clean);
    if (key !== me.key && this.sql.exec("SELECT 1 FROM players WHERE key = ?", key).toArray().length) return { error: "taken" };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE players SET key = ?, name = ? WHERE key = ?", key, clean, me.key);
      if (key !== me.key) {
        this.sql.exec("UPDATE guesses SET player = ? WHERE player = ?", key, me.key);
        this.sql.exec("UPDATE results SET player = ? WHERE player = ?", key, me.key);
        if (this.meta("owner") === me.key) this.setMeta("owner", key);
      }
    });
    // live sockets are tagged with the old key: close them, the client reconnects with the new identity
    if (key !== me.key) for (const ws of this.ctx.getWebSockets(me.key)) { try { ws.close(4000, "renamed"); } catch {} }
    this.touch();
    await this.broadcast();
    if (clean !== me.name) this.event(`✏️ ${me.name} s'appelle maintenant ${clean}`);
    return { token, name: clean };
  }

  /** Undo a give-up while the hour is still running (the word was not revealed). */
  async resume(token: string): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const round = this.active(L).round;
    if (this.result(round, me.key)?.status !== "gaveup") return { error: "not_given_up" };
    this.sql.exec("UPDATE results SET status = 'playing', finished = NULL WHERE round = ? AND player = ?", round, me.key);
    await this.broadcast();
    this.event(`↩️ ${me.name} reprend la partie`);
    return { ok: true };
  }

  /**
   * Easy rooms: once I'm done with the word (found, or given up), launch another one right away for the
   * whole room: the next themed bonus word (themes in turn: Stranger Things, fast-food, Mario…), never played
   * in this room. It lasts until the next word of the hour.
   */
  async bonus(token: string): Promise<{ round: number } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    if (this.level(L) !== "kid") return { error: "forbidden" };
    const { round } = this.active(L);
    const done = this.result(round, me.key)?.status;
    const finished = done === "won" || done === "gaveup" || (this.mode() === "collab" && this.teamWon(round));
    if (!finished) return { round }; // someone else just launched one: play it
    const hour = roundAt(L.meta);
    const data = gameData(this.env.DATA);
    const [B, kid] = await Promise.all([data.bonus(L), data.schedule(L, "kid")]);
    if (!B || !kid) return { error: "no_data" };
    const played = this.sql.exec<{ round: number }>("SELECT round FROM bonus WHERE round > ? ORDER BY at", BONUS).toArray().map((r) => r.round);
    const seen = new Set(played.map((r) => B.words[r - BONUS - 1]));
    for (const r of this.sql.exec<{ round: number }>("SELECT DISTINCT round FROM guesses WHERE round <= ?", hour)) seen.add(kid[r.round - 1]);
    // carry on the rotation after the last bonus word played here
    const from = played.length ? played[played.length - 1] - BONUS : 0;
    let next = 0;
    for (let k = 0; k < B.words.length && !next; k++) {
      const i = (from + k) % B.words.length;
      if (!seen.has(B.words[i])) next = BONUS + i + 1;
    }
    if (!next) return { error: "no_bonus" };
    this.sql.exec("INSERT INTO bonus (round, base, at) VALUES (?, ?, ?)", next, hour, Date.now());
    this.touch();
    await this.broadcast();
    this.event(`🎈 ${me.name} lance un mot bonus : ${await this.themeOf(L, next)} !`);
    return { round: next };
  }

  /** Anyone in the room can switch between défi and collaboratif, effective immediately. */
  async setMode(token: string, mode: Mode): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    if (!me) return { error: "auth" };
    const next: Mode = mode === "collab" ? "collab" : "defi";
    if (next === this.mode()) return { ok: true };
    this.setMeta("mode", next);
    this.touch();
    await this.broadcast();
    this.event(next === "collab" ? `🤝 ${me.name} passe la room en mode collaboratif` : `🏆 ${me.name} passe la room en mode défi`);
    return { ok: true };
  }

  /** Delete a player and everything they played; the oldest remaining player inherits an orphaned room. */
  private removePlayer(key: string) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM players WHERE key = ?", key);
      this.sql.exec("DELETE FROM guesses WHERE player = ?", key);
      this.sql.exec("DELETE FROM results WHERE player = ?", key);
      if (this.meta("owner") === key) {
        const next = this.sql.exec<{ key: string }>("SELECT key FROM players ORDER BY joined LIMIT 1").toArray()[0];
        if (next) this.setMeta("owner", next.key);
        else this.sql.exec("DELETE FROM meta WHERE k = 'owner'");
      }
    });
    for (const ws of this.ctx.getWebSockets(key)) { try { ws.close(4001, "kicked"); } catch {} }
    this.touch();
  }

  /** The creator (or an admin) removes a player from the room. */
  async kick(token: string, name: string): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    if (!me) return { error: "auth" };
    if (this.meta("owner") !== me.key && !ADMINS.includes(me.key)) return { error: "forbidden" };
    const key = nameKey(String(name ?? ""));
    const target = this.sql.exec<{ name: string }>("SELECT name FROM players WHERE key = ?", key).toArray()[0];
    if (!target) return { error: "not_found" };
    if (key === me.key) return { error: "forbidden" };
    this.removePlayer(key);
    await this.broadcast();
    this.event(`🚪 ${target.name} a été retiré·e de la room`);
    return { ok: true };
  }

  /** I leave the room for good: my name, words and points go away. */
  async leave(token: string): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    if (!me) return { ok: true }; // already gone
    this.removePlayer(me.key);
    await this.broadcast();
    this.event(`👋 ${me.name} a quitté la room`);
    return { ok: true };
  }

  /** The creator (or an admin) renames the room. */
  async setName(token: string, name: string): Promise<{ name: string } | RoomError> {
    const me = this.player(token);
    if (!me) return { error: "auth" };
    if (this.meta("owner") !== me.key && !ADMINS.includes(me.key)) return { error: "forbidden" };
    const clean = String(name ?? "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!clean) return { error: "bad_name" };
    if (clean === this.meta("name")) return { name: clean };
    this.setMeta("name", clean);
    this.touch();
    await this.broadcast(); // also updates the public directory
    this.event(`✏️ La room s'appelle maintenant « ${clean} »`);
    return { name: clean };
  }

  async setVisibility(token: string, visibility: Visibility): Promise<{ ok: true } | RoomError> {
    const me = this.player(token);
    if (!me) return { error: "auth" };
    if (this.meta("owner") !== me.key) return { error: "forbidden" };
    this.setMeta("visibility", visibility === "public" ? "public" : "private");
    await this.broadcast();
    this.event(visibility === "public" ? "🌍 La room est maintenant publique" : "🔒 La room est maintenant privée");
    return { ok: true };
  }

  /**
   * The answer and everyone's words for a round: only once I found it, or once the hour is over
   * (giving up does not reveal the word before the end of the hour).
   */
  async reveal(token: string, round: number): Promise<{ top: Entry[]; players: { name: string; guesses: RoomGuess[] }[] } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const mine = this.result(round, me.key)?.status;
    const isBonus = this.sql.exec("SELECT 1 FROM bonus WHERE round = ?", round).toArray().length > 0;
    const unlocked = mine === "won" || (this.mode() === "collab" && this.teamWon(round))
      || (isBonus && (mine === "gaveup" || round !== this.active(L).round)); // a bonus word: giving up shows it right away, and it's open once over
    if (round >= roundAt(L.meta) && !unlocked) return { error: "locked" };
    const r = await gameData(this.env.DATA).round(L, round, this.level(L));
    if (!r) return { error: "no_data" };
    const players = this.sql.exec<{ key: string; name: string }>("SELECT key, name FROM players ORDER BY joined").toArray().map((p) => ({
      name: p.name,
      guesses: this.sql.exec<{ id: number; word: string; rank: number; cos: number; hint: number; n: number }>(
        "SELECT id, word, rank, cos, hint, n FROM guesses WHERE round = ? AND player = ? ORDER BY rank", round, p.key).toArray()
        .map((g) => ({ ...g, hint: g.hint === 1 })),
    })).filter((p) => p.guesses.length);
    return { top: gameData(this.env.DATA).top(L, r), players };
  }

  /**
   * Past rounds the room played (newest first, never the current one): the word, and for each player
   * their result and their words from closest to farthest.
   */
  async history(token: string, before?: number, limit = 8): Promise<{ rounds: PastRound[]; more: boolean } | RoomError> {
    const me = this.player(token);
    const L = await this.lang();
    if (!me || !L) return { error: "auth" };
    const current = this.active(L).round, hour = roundAt(L.meta);
    // most recently played first; the word of the hour stays out until it's over, even while a bonus word is played; before = last activity of the previous page
    const listed = this.sql.exec<{ round: number; at: number }>(
      `SELECT round, MAX(at) AS at FROM guesses WHERE round <> ? AND (round < ? OR round IN (SELECT round FROM bonus)) GROUP BY round
       HAVING MAX(at) < ? ORDER BY MAX(at) DESC LIMIT ?`, current, hour, before ?? Number.MAX_SAFE_INTEGER, limit + 1).toArray();
    const list = listed.map((r) => r.round);
    const lastAt = new Map(listed.map((r) => [r.round, r.at]));
    const bases = new Map(this.sql.exec<{ round: number; base: number }>("SELECT round, base FROM bonus").toArray().map((b) => [b.round, b.base]));
    const data = gameData(this.env.DATA), level = this.level(L);
    const secret = new Map(await Promise.all(list.map(async (r) => [r, await data.word(L, r, level)] as const)));
    const themes = new Map(await Promise.all(list.map(async (r) => [r, await this.themeOf(L, r)] as const)));
    const people = this.sql.exec<{ key: string; name: string }>("SELECT key, name FROM players").toArray();
    const nameOf = new Map(people.map((p) => [p.key, p.name]));
    const rounds = list.slice(0, limit).map((round): PastRound => {
      // every word proposed in the room, closest first, with who proposed it and at which try
      const byWord = new Map<string, PastRound["words"][number]>();
      for (const g of this.sql.exec<{ player: string; word: string; rank: number; hint: number; n: number }>(
        "SELECT player, word, rank, hint, n FROM guesses WHERE round = ? ORDER BY rank, at", round)) {
        const name = nameOf.get(g.player);
        if (!name) continue;
        const w = byWord.get(g.word) ?? { word: g.word, rank: g.rank, by: [] };
        w.by.push({ name, n: g.n, hint: g.hint === 1 });
        byWord.set(g.word, w);
      }
      const players = people.map((p) => {
        const res = this.result(round, p.key);
        return res ? { name: p.name, status: res.status, tries: res.tries, hints: res.hints, place: res.place } : null;
      }).filter((p) => p !== null)
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.tries - b.tries);
      return { round, word: secret.get(round) ?? null, players, words: [...byWord.values()], at: lastAt.get(round) ?? 0, bonus: bases.get(round) ?? null, theme: themes.get(round) ?? null };
    });
    return { rounds, more: list.length > limit };
  }

  // ------------------------------------------------------------------ live updates (hibernatable WebSockets)

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const me = this.player(new URL(req.url).searchParams.get("token") ?? undefined);
    const pair = new WebSocketPair();
    if (!me) {
      // removed from the room (or the room expired): say so instead of letting the client retry forever
      pair[1].accept();
      pair[1].close(4001, "kicked");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    this.ctx.acceptWebSocket(pair[1], [me.key]);
    const snap = await this.snapshot();
    pair[1].send(JSON.stringify({ type: "snapshot", snapshot: snap }));
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, "bye"); } catch {}
    await this.broadcast();
  }

  async alarm() {
    // no activity for EXPIRY_MS: the room disappears
    const code = this.meta("code");
    if (code) await this.directory().remove(code).catch(() => {});
    await this.ctx.storage.deleteAll();
  }
}
