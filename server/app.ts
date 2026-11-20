import { Hono } from "hono";

/** Storage abstraction: local files in dev, R2 on Cloudflare. Keys look like "fr/public/meta.json". */
export interface Store {
  bytes(key: string): Promise<Uint8Array | null>;
}

interface Meta {
  lang: string;
  timezone: string;
  start: string; // ISO datetime of round 1
  period: number; // seconds per round
  rounds: number;
  vocabSize: number;
  dims: number;
  vecDims: number;
  credits: string[];
  version: string;
}

interface Round {
  secret: number;
  cos: Int16Array; // similarity × 10000
  rank: Uint16Array; // 0 = secret
  order: Uint16Array; // word ids by rank
}

interface Lang {
  meta: Meta;
  words: string[];
  index: Map<string, number>;
  schedule: string[];
  vectors: Float32Array;
}

const PUBLIC_FILES: Record<string, string> = {
  "vocab.txt": "text/plain; charset=utf-8",
  "forms.json": "application/json",
  "vec.bin": "application/octet-stream",
};

export const roundAt = (m: Meta, now = Date.now()) => Math.floor((now - Date.parse(m.start)) / (m.period * 1000)) + 1;
export const roundStart = (m: Meta, n: number) => Date.parse(m.start) + (n - 1) * m.period * 1000;

export function createApp(store: Store) {
  const dec = new TextDecoder();
  const langs = new Map<string, Promise<Lang | null>>();
  const rounds = new Map<string, Round>();

  const json = async <T>(key: string): Promise<T | null> => {
    const b = await store.bytes(key);
    return b ? JSON.parse(dec.decode(b)) : null;
  };

  const loadLang = (code: string) => {
    if (!/^[a-z]{2}$/.test(code)) return Promise.resolve(null);
    if (!langs.has(code))
      langs.set(code, (async () => {
        const [meta, vocab, sched, vec] = await Promise.all([
          json<Meta>(`${code}/public/meta.json`),
          store.bytes(`${code}/public/vocab.txt`),
          json<{ words: string[] }>(`${code}/private/schedule.json`),
          store.bytes(`${code}/private/vectors.f32`),
        ]);
        if (!meta || !vocab || !sched || !vec) return null;
        const words = dec.decode(vocab).split("\n").filter(Boolean);
        const buf = vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength);
        return { meta, words, index: new Map(words.map((w, i) => [w, i])), schedule: sched.words, vectors: new Float32Array(buf) };
      })());
    return langs.get(code)!;
  };

  /** Similarity table of a round, computed from the vectors (~15 ms) and cached. */
  const getRound = (L: Lang, n: number): Round => {
    const key = `${L.meta.lang}/${n}`;
    let r = rounds.get(key);
    if (r) return r;
    const { vectors: M, words } = L;
    const D = L.meta.dims, V = words.length;
    const secret = L.index.get(L.schedule[n - 1])!;
    const sims = new Float32Array(V);
    const s0 = secret * D;
    for (let i = 0; i < V; i++) {
      let dot = 0;
      const o = i * D;
      for (let k = 0; k < D; k++) dot += M[o + k] * M[s0 + k];
      sims[i] = dot;
    }
    sims[secret] = 2; // always first, even with float noise
    const order = Uint16Array.from({ length: V }, (_, i) => i).sort((a, b) => sims[b] - sims[a] || a - b);
    const rank = new Uint16Array(V);
    order.forEach((id, r) => (rank[id] = r));
    sims[secret] = 1;
    const cos = Int16Array.from(sims, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 10000));
    r = { secret, cos, rank, order };
    if (rounds.size >= 48) rounds.delete(rounds.keys().next().value!);
    rounds.set(key, r);
    return r;
  };

  const entry = (L: Lang, r: Round, id: number) => ({ id, word: L.words[id], cos: r.cos[id] / 100, rank: r.rank[id] });

  type Vars = { L: Lang; n: number; current: number };
  const app = new Hono<{ Variables: Vars }>().basePath("/api");

  /** Resolve :lang and ?round= (defaults to the current one; future rounds are refused). */
  app.use("/:lang/*", async (c, next) => {
    const L = await loadLang(c.req.param("lang"));
    if (!L) return c.json({ error: "unknown language" }, 404);
    const current = Math.min(roundAt(L.meta), L.meta.rounds);
    const q = c.req.query("round");
    const n = q ? Number(q) : current;
    if (!Number.isInteger(n) || n < 1 || n > current) return c.json({ error: "round not available", current }, 404);
    c.set("L", L);
    c.set("n", n);
    c.set("current", current);
    await next();
  });

  app.get("/:lang/meta", (c) => {
    const { meta: m } = c.get("L");
    const current = c.get("current");
    return c.json({
      lang: m.lang, current, period: m.period, start: m.start,
      currentStart: new Date(roundStart(m, current)).toISOString(),
      nextAt: new Date(roundStart(m, current + 1)).toISOString(),
      vocabSize: m.vocabSize, vecDims: m.vecDims, credits: m.credits, version: m.version,
    });
  });

  app.get("/:lang/public/:file", async (c) => {
    const file = c.req.param("file");
    if (!(file in PUBLIC_FILES)) return c.notFound();
    const b = await store.bytes(`${c.req.param("lang")}/public/${file}`);
    if (!b) return c.notFound();
    return c.body(b as Uint8Array<ArrayBuffer>, 200, {
      "content-type": PUBLIC_FILES[file],
      "cache-control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache",
    });
  });

  app.get("/:lang/guess", (c) => {
    const L = c.get("L");
    const id = L.index.get(c.req.query("w") ?? "");
    if (id === undefined) return c.json({ error: "unknown word" }, 404);
    return c.json(entry(L, getRound(L, c.get("n")), id));
  });

  /** A word at (or just above) the requested rank. */
  app.get("/:lang/hint", (c) => {
    const L = c.get("L");
    const r = getRound(L, c.get("n"));
    const k = Math.min(Math.max(1, Number(c.req.query("rank")) || 1000), r.order.length - 1);
    return c.json(entry(L, r, r.order[k]));
  });

  /** Nearest words — the client only calls this once the round is over for the player. */
  app.get("/:lang/top", (c) => {
    const L = c.get("L");
    const r = getRound(L, c.get("n"));
    const k = Math.min(500, Number(c.req.query("n")) || 100);
    return c.json(Array.from(r.order.subarray(0, k + 1), (id) => entry(L, r, id)));
  });

  return app;
}
