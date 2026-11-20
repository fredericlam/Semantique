import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

/**
 * Directory of public rooms: a single Durable Object ("directory") that rooms report to.
 * Private rooms never appear here; they are only reachable with their code.
 */

export interface PublicRoom {
  code: string;
  name: string;
  level: string;
  players: number;
  online: number;
  found: number; // players who found the current word
  round: number;
  lastActive: number;
}

const STALE_MS = 7 * 24 * 3600 * 1000; // hidden after a week without activity

export class Directory extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY, lang TEXT, name TEXT, players INTEGER, online INTEGER, found INTEGER,
      round INTEGER, last_active INTEGER)`);
    try { this.sql.exec("ALTER TABLE rooms ADD COLUMN level TEXT DEFAULT 'adult'"); } catch {} // added with levels
  }

  async upsert(lang: string, r: PublicRoom): Promise<void> {
    this.sql.exec(`
      INSERT INTO rooms (code, lang, name, level, players, online, found, round, last_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, level = excluded.level, players = excluded.players,
        online = excluded.online, found = excluded.found, round = excluded.round, last_active = excluded.last_active`,
      r.code, lang, r.name, r.level, r.players, r.online, r.found, r.round, r.lastActive);
  }

  async remove(code: string): Promise<void> {
    this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  /** Most lively first: people online, then recent activity. */
  async list(lang: string, limit = 50): Promise<PublicRoom[]> {
    this.sql.exec("DELETE FROM rooms WHERE last_active < ?", Date.now() - STALE_MS);
    return this.sql.exec<{ code: string; name: string; level: string | null; players: number; online: number; found: number; round: number; last_active: number }>(
      "SELECT * FROM rooms WHERE lang = ? ORDER BY online DESC, last_active DESC LIMIT ?", lang, limit).toArray()
      .map((r) => ({ code: r.code, name: r.name, level: r.level ?? "adult", players: r.players, online: r.online, found: r.found, round: r.round, lastActive: r.last_active }));
  }
}
