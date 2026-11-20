import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

/**
 * "Trouvé par N personnes": one row per (level, round, device) that found the word.
 * A device is an anonymous random id kept in the browser; the word itself is checked by the API.
 */
export class Stats extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS finds (
      level TEXT, round INTEGER, device TEXT, at INTEGER, PRIMARY KEY (level, round, device))`);
  }

  async record(level: string, round: number, device: string): Promise<void> {
    this.sql.exec("INSERT OR IGNORE INTO finds (level, round, device, at) VALUES (?, ?, ?, ?)", level, round, device, Date.now());
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
