/** Game data access, shared by the API Worker and the Room Durable Object. */
import { roundAt as timelineRoundAt, roundStart as timelineRoundStart } from "../shared/timeline.ts";

export interface Store {
  /** Whole object, or a byte range of it. Keys look like "fr/public/meta.json". */
  get(key: string, range?: { offset: number; length: number }): Promise<Uint8Array | null>;
}

export interface Meta {
  lang: string;
  timezone: string;
  start: string; // ISO datetime of round 1
  period: number; // seconds per round
  rounds: number;
  chunk: number; // rounds per table file
  levels: string[]; // difficulty levels, e.g. kid / teen / adult
  defaultLevel: string;
  vocabSize: number;
  vecDims: number;
  credits: string[];
  version: string;
}

export interface Lang {
  meta: Meta;
  words: string[];
  index: Map<string, number>;
}

export interface Round {
  cos: Int16Array; // similarity × 10000
  rank: Uint16Array; // 0 = secret
  order: Uint16Array; // word ids by rank
}

export interface Entry {
  id: number;
  word: string;
  cos: number;
  rank: number;
}

/** Day/night rhythm shared with the app (shared/timeline.ts): hourly by day, every 3 h at night. */
export const roundAt = (m: Meta, now = Date.now()) => Math.min(timelineRoundAt(m, now), m.rounds);
export const roundStart = (m: Meta, n: number) => timelineRoundStart(m, n);

/**
 * Next hint target: first a word in the top 1000 (top 300 for kids), then ~4x (kids: ~3x) closer than
 * the best guess; null if nothing is left. Keep in sync with src/lib/game.ts.
 */
export function nextHintRank(ranks: number[], level = "adult"): number | null {
  const best = Math.min(...ranks, Infinity);
  if (best <= 1) return null;
  const known = new Set(ranks);
  const [first, factor] = level === "kid" ? [300, 3] : [1000, 4];
  let r = best > first ? first : Math.max(1, Math.floor(best / factor));
  while (r >= 1 && known.has(r)) r--;
  return r >= 1 ? r : null;
}

const dec = new TextDecoder();

export class GameData {
  private langs = new Map<string, Promise<Lang | null>>();
  private rounds = new Map<string, Promise<Round | null>>();
  private schedules = new Map<string, Promise<string[] | null>>();

  constructor(private store: Store) {}

  lang(code: string): Promise<Lang | null> {
    if (!/^[a-z]{2}$/.test(code)) return Promise.resolve(null);
    if (!this.langs.has(code)) {
      const p = (async () => {
        const [meta, vocab] = await Promise.all([
          this.store.get(`${code}/public/meta.json`),
          this.store.get(`${code}/public/vocab.txt`),
        ]);
        if (!meta || !vocab) return null;
        const words = dec.decode(vocab).split("\n").filter(Boolean);
        return { meta: JSON.parse(dec.decode(meta)) as Meta, words, index: new Map(words.map((w, i) => [w, i])) };
      })();
      p.then((v) => v ?? this.langs.delete(code));
      this.langs.set(code, p);
    }
    return this.langs.get(code)!;
  }

  /** A valid level name (falls back to the default one). */
  level(L: Lang, level: string | undefined | null): string {
    return level && L.meta.levels?.includes(level) ? level : (L.meta.defaultLevel ?? "adult");
  }

  round(L: Lang, n: number, level: string): Promise<Round | null> {
    const key = `${L.meta.lang}/${level}/${n}`;
    if (!this.rounds.has(key)) {
      const V = L.words.length;
      const file = `${L.meta.lang}/private/${level}/rounds/${String(Math.floor((n - 1) / L.meta.chunk)).padStart(4, "0")}.bin`;
      const p = this.store.get(file, { offset: ((n - 1) % L.meta.chunk) * 4 * V, length: 4 * V }).then((b) => {
        if (!b) return null;
        const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        const cos = new Int16Array(buf, 0, V);
        const rank = new Uint16Array(buf, 2 * V, V);
        const order = new Uint16Array(V);
        rank.forEach((r, id) => (order[r] = id));
        return { cos, rank, order };
      });
      p.then((v) => v ?? this.rounds.delete(key));
      if (this.rounds.size >= 96) this.rounds.delete(this.rounds.keys().next().value!);
      this.rounds.set(key, p);
    }
    return this.rounds.get(key)!;
  }

  /** Secret words of a level, in round order. Never send a current or future one to a client. */
  schedule(L: Lang, level: string): Promise<string[] | null> {
    const key = `${L.meta.lang}/${level}`;
    if (!this.schedules.has(key)) {
      const p = this.store.get(`${L.meta.lang}/private/${level}/schedule.json`)
        .then((b) => (b ? (JSON.parse(dec.decode(b)).words as string[]) : null));
      p.then((v) => v ?? this.schedules.delete(key));
      this.schedules.set(key, p);
    }
    return this.schedules.get(key)!;
  }

  entry(L: Lang, r: Round, id: number): Entry {
    return { id, word: L.words[id], cos: r.cos[id] / 100, rank: r.rank[id] };
  }

  top(L: Lang, r: Round, k = 100): Entry[] {
    return Array.from(r.order.subarray(0, k + 1), (id) => this.entry(L, r, id));
  }

  publicFile(lang: string, file: string): Promise<Uint8Array | null> {
    return this.store.get(`${lang}/public/${file}`);
  }
}

/** R2-backed store (Workers). */
export function r2Store(bucket: R2Bucket): Store {
  return {
    async get(key, range) {
      const obj = await bucket.get(key, range ? { range } : undefined);
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
  };
}

let shared: GameData | null = null;
/** One GameData per isolate, so caches survive across requests. */
export const gameData = (bucket: R2Bucket) => (shared ??= new GameData(r2Store(bucket)));
