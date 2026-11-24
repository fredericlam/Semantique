import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

/**
 * "Trouvé par N personnes": one row per (level, round, device) that found the word.
 * A device is an anonymous random id kept in the browser; the word itself is checked by the API.
 */
export interface BoardRow {
  pos: number;
  name: string;
  anonymous: boolean;
  words: number;
  avgTries: number | null;
  hints: number;
  me: boolean;
}

/** 4 stable characters from a device id, so anonymous players can be told apart without exposing the id. */
function tag(device: string): string {
  let h = 2166136261;
  for (let i = 0; i < device.length; i++) h = Math.imul(h ^ device.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(-4);
}

export class Stats extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS finds (
      level TEXT, round INTEGER, device TEXT, at INTEGER, PRIMARY KEY (level, round, device))`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS pseudos (device TEXT PRIMARY KEY, name TEXT NOT NULL)");
    const cols = new Set(this.sql.exec<{ name: string }>("PRAGMA table_info(finds)").toArray().map((c) => c.name));
    if (!cols.has("tries")) this.sql.exec("ALTER TABLE finds ADD COLUMN tries INTEGER");
    if (!cols.has("hints")) this.sql.exec("ALTER TABLE finds ADD COLUMN hints INTEGER");
  }

  async record(level: string, round: number, device: string, tries: number | null = null, hints: number | null = null): Promise<void> {
    this.sql.exec("INSERT OR IGNORE INTO finds (level, round, device, at, tries, hints) VALUES (?, ?, ?, ?, ?, ?)",
      level, round, device, Date.now(), tries, hints);
  }

  /** The name shown for this device in the daily ranking (empty: anonymous). */
  async setPseudo(device: string, name: string): Promise<void> {
    if (name) this.sql.exec("INSERT INTO pseudos (device, name) VALUES (?, ?) ON CONFLICT(device) DO UPDATE SET name = excluded.name", device, name);
    else this.sql.exec("DELETE FROM pseudos WHERE device = ?", device);
  }

  /**
   * Ranking over a range of rounds (today): most words found, then fewest tries on average, then fewest hints.
   * Devices never leave the server: anonymous players get a short tag derived from theirs.
   */
  async board(level: string, from: number, to: number, device: string, limit = 20): Promise<{ rows: BoardRow[]; me: BoardRow | null; players: number }> {
    const rows = this.sql.exec<{ device: string; name: string | null; words: number; avg: number | null; hints: number; pos: number }>(`
      WITH b AS (
        SELECT f.device, p.name, COUNT(*) AS words, AVG(f.tries) AS avg, COALESCE(SUM(f.hints), 0) AS hints, MIN(f.at) AS first
        FROM finds f LEFT JOIN pseudos p ON p.device = f.device
        WHERE f.level = ? AND f.round BETWEEN ? AND ? GROUP BY f.device)
      SELECT *, RANK() OVER (ORDER BY words DESC, avg IS NULL, avg, hints) AS pos FROM b
      ORDER BY pos, first`, level, from, to).toArray();
    const out = (r: (typeof rows)[number]): BoardRow => ({
      pos: r.pos, name: r.name ?? `anonyme·${tag(r.device)}`, anonymous: !r.name, words: r.words,
      avgTries: r.avg === null ? null : Math.round(r.avg * 10) / 10, hints: r.hints, me: r.device === device,
    });
    const mine = rows.find((r) => r.device === device);
    return { rows: rows.slice(0, limit).map(out), me: mine ? out(mine) : null, players: rows.length };
  }

  /** Finds per round, for the given rounds. */
  async counts(level: string, rounds: number[]): Promise<Record<number, number>> {
    if (!rounds.length) return {};
    const lo = Math.min(...rounds), hi = Math.max(...rounds);
    const out: Record<number, number> = {};
    for (const r of this.sql.exec<{ round: number; n: number }>(
      "SELECT round, COUNT(*) AS n FROM finds WHERE level = ? AND round BETWEEN ? AND ? GROUP BY round", level, lo, hi))
      out[r.round] = r.n;
    return out;
  }

  /** Total finds and distinct players over a range of rounds (e.g. today). */
  async range(level: string, from: number, to: number): Promise<{ finds: number; players: number }> {
    return this.sql.exec<{ finds: number; players: number }>(
      "SELECT COUNT(*) AS finds, COUNT(DISTINCT device) AS players FROM finds WHERE level = ? AND round BETWEEN ? AND ?",
      level, from, to).one();
  }
}
