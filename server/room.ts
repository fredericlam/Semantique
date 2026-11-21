import { DurableObject } from "cloudflare:workers";
import { gameData, nextHintRank, roundAt, type Entry, type Lang } from "./data.ts";
import type { Env } from "./env.ts";

/**
 * One Durable Object per room. Everyone plays the word of the hour; the room records each
 * player's guesses itself, so it alone decides who found the word, in how many tries.
 */

const EXPIRY_MS = 30 * 24 * 3600 * 1000; // rooms vanish after 30 days without activity
const POINTS = [5, 3, 2]; // 1st, 2nd, 3rd to find; then 1; +1 without hints

export type RoomError = { error: "not_found" | "taken" | "bad_name" | "auth" | "unknown_word" | "finished" | "no_hint" | "locked" | "no_data" | "forbidden" | "not_given_up" };
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
  round: number;
  players: { name: string; online: boolean; now: PlayerRound | null; points: number; wins: number }[];
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
    const round = roundAt(L.meta);
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
    return { code, name: this.meta("name") || `Room ${code}`, visibility: this.visibility(), mode: this.mode(), level: this.level(L), owner, round, players };
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
    const key = nameKey(clean);
    const existing = this.sql.exec<{ name: string; token: string }>("SELECT name, token FROM players WHERE key = ?", key).toArray()[0];
    if (existing) {
      if (existing.token === token) return { token: existing.token, name: existing.name };
      return { error: "taken" };
    }
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
    const n = round ?? roundAt(L.meta);
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
    const round = roundAt(L.meta);
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
    const round = roundAt(L.meta);
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
    const round = roundAt(L.meta);
    if (this.result(round, me.key)?.status !== "gaveup") return { error: "not_given_up" };
    this.sql.exec("UPDATE results SET status = 'playing', finished = NULL WHERE round = ? AND player = ?", round, me.key);
    await this.broadcast();
    this.event(`↩️ ${me.name} reprend la partie`);
    return { ok: true };
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
    const unlocked = this.result(round, me.key)?.status === "won" || (this.mode() === "collab" && this.teamWon(round));
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

  // ------------------------------------------------------------------ live updates (hibernatable WebSockets)

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const me = this.player(new URL(req.url).searchParams.get("token") ?? undefined);
    if (!me) return new Response("unauthorized", { status: 401 });
    const pair = new WebSocketPair();
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
