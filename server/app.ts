import { Hono } from "hono";
import { gameData, roundAt, roundStart, type Lang } from "./data.ts";
import type { Env } from "./env.ts";
import type { RoomError } from "./room.ts";
import { createIssue, rateLimited, type BugReport } from "./bug.ts";

const PUBLIC_FILES: Record<string, string> = {
  "vocab.txt": "text/plain; charset=utf-8",
  "forms.json": "application/json",
  "vec.bin": "application/octet-stream",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, I/1
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
const validCode = (c: string) => new RegExp(`^[${CODE_ALPHABET}]{5}$`).test(c);

const ERROR_STATUS: Record<RoomError["error"], 400 | 401 | 403 | 404 | 409 | 500> = {
  not_found: 404, taken: 409, bad_name: 400, auth: 401, unknown_word: 404, finished: 409, no_hint: 409, locked: 403, no_data: 500,
  forbidden: 403, not_given_up: 409,
};
const isError = (x: unknown): x is RoomError => typeof x === "object" && x !== null && "error" in x;

type Vars = { L: Lang; n: number; current: number; level: string };

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath("/api");

  /** Bug report → GitHub issue. Registered before the /:lang middleware. */
  app.post("/bug", async (c) => {
    const report = await c.req.json<BugReport>().catch(() => null);
    const text = String(report?.text ?? "").trim();
    if (text.length < 5 || text.length > 2000) return c.json({ error: "bad_text" }, 400);
    if (rateLimited(c.req.header("cf-connecting-ip") ?? "local")) return c.json({ error: "too_many" }, 429);
    const res = await createIssue(c.env, { text, context: report?.context });
    return "url" in res ? c.json(res, 201) : c.json({ error: res.error, repo: c.env.GITHUB_REPO ?? null }, res.status as 502 | 503);
  });

  /** Resolve :lang and ?round= (defaults to the current one; future rounds are refused). */
  app.use("/:lang/*", async (c, next) => {
    const L = await gameData(c.env.DATA).lang(c.req.param("lang"));
    if (!L) return c.json({ error: "unknown language" }, 404);
    const current = roundAt(L.meta);
    const q = c.req.query("round");
    const n = q ? Number(q) : current;
    if (!Number.isInteger(n) || n < 1 || n > current) return c.json({ error: "round not available", current }, 404);
    c.set("L", L);
    c.set("n", n);
    c.set("current", current);
    c.set("level", gameData(c.env.DATA).level(L, c.req.query("level")));
    await next();
  });

  app.get("/:lang/meta", (c) => {
    const { meta: m } = c.get("L");
    const current = c.get("current");
    return c.json({
      lang: m.lang, current, period: m.period, start: m.start, timezone: m.timezone,
      currentStart: new Date(roundStart(m, current)).toISOString(),
      nextAt: new Date(roundStart(m, current + 1)).toISOString(),
      vocabSize: m.vocabSize, vecDims: m.vecDims, credits: m.credits, version: m.version,
      levels: m.levels ?? ["adult"], defaultLevel: m.defaultLevel ?? "adult",
    });
  });

  app.get("/:lang/public/:file", async (c) => {
    const file = c.req.param("file");
    if (!(file in PUBLIC_FILES)) return c.notFound();
    const b = await gameData(c.env.DATA).publicFile(c.req.param("lang"), file);
    if (!b) return c.notFound();
    return c.body(b as Uint8Array<ArrayBuffer>, 200, {
      "content-type": PUBLIC_FILES[file],
      "cache-control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache",
    });
  });

  // ---------------------------------------------------------------- solo

  app.get("/:lang/guess", async (c) => {
    const L = c.get("L"), data = gameData(c.env.DATA);
    const id = L.index.get(c.req.query("w") ?? "");
    if (id === undefined) return c.json({ error: "unknown word" }, 404);
    const r = await data.round(L, c.get("n"), c.get("level"));
    return r ? c.json(data.entry(L, r, id)) : c.json({ error: "no data" }, 500);
  });

  /** A word at (or just above) the requested rank; never the secret. */
  app.get("/:lang/hint", async (c) => {
    const L = c.get("L"), data = gameData(c.env.DATA);
    const r = await data.round(L, c.get("n"), c.get("level"));
    if (!r) return c.json({ error: "no data" }, 500);
    const k = Math.min(Math.max(1, Number(c.req.query("rank")) || 1000), r.order.length - 1);
    return c.json(data.entry(L, r, r.order[k]));
  });

  /** Nearest words: for past rounds, or with proof of having found the secret (?found=word). */
  app.get("/:lang/top", async (c) => {
    const L = c.get("L"), data = gameData(c.env.DATA), n = c.get("n");
    const r = await data.round(L, n, c.get("level"));
    if (!r) return c.json({ error: "no data" }, 500);
    const found = L.index.get(c.req.query("found") ?? "");
    if (n >= c.get("current") && (found === undefined || r.rank[found] !== 0))
      return c.json({ error: "locked", revealAt: new Date(roundStart(L.meta, n + 1)).toISOString() }, 403);
    return c.json(data.top(L, r, Math.min(500, Number(c.req.query("n")) || 100)));
  });

  /** Words of the last finished rounds (up to 48 h), newest first, with how many found them. Never the current word. */
  app.get("/:lang/history", async (c) => {
    const L = c.get("L"), current = c.get("current"), level = c.get("level");
    const words = await gameData(c.env.DATA).schedule(L, level);
    if (!words) return c.json({ error: "no data" }, 500);
    const rounds: number[] = [];
    for (let n = current - 1; n >= Math.max(1, current - 48); n--) rounds.push(n);
    const found = await stats(c.env).counts(level, rounds);
    return c.json(rounds.map((n) => ({ round: n, word: words[n - 1], found: found[n] ?? 0 })), 200, { "cache-control": "public, max-age=60" });
  });

  // ---------------------------------------------------------------- "trouvé par N personnes"

  const stats = (env: Env) => env.STATS.get(env.STATS.idFromName("global"));
  /** First round whose start falls on today's date (in the game's time zone). */
  const firstRoundToday = (L: Lang, current: number) => {
    const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: L.meta.timezone }).format(t);
    const today = day(Date.now());
    let n = current;
    while (n > 1 && day(roundStart(L.meta, n - 1)) === today) n--;
    return n;
  };
  const counters = async (env: Env, L: Lang, level: string, round: number, current: number) => {
    const s = stats(env);
    const [hour, today] = await Promise.all([s.counts(level, [round]), s.range(level, firstRoundToday(L, current), current)]);
    return { round, hour: hour[round] ?? 0, todayFinds: today.finds, todayPlayers: today.players };
  };

  app.get("/:lang/stats", async (c) => {
    const L = c.get("L");
    return c.json(await counters(c.env, L, c.get("level"), c.get("n"), c.get("current")), 200, { "cache-control": "no-store" });
  });

  /** "I found it": counted once per device and round, only with the right word. */
  app.post("/:lang/found", async (c) => {
    const L = c.get("L"), level = c.get("level"), current = c.get("current");
    const { round, word, device } = await c.req.json<{ round: number; word: string; device: string }>().catch(() => ({} as never));
    if (!Number.isInteger(round) || round < 1 || round > current || !/^[\w-]{8,64}$/.test(String(device ?? "")))
      return c.json({ error: "bad request" }, 400);
    const id = L.index.get(String(word ?? ""));
    const r = await gameData(c.env.DATA).round(L, round, level);
    if (!r || id === undefined || r.rank[id] !== 0) return c.json({ error: "wrong word" }, 403);
    await stats(c.env).record(level, round, device);
    return c.json(await counters(c.env, L, level, round, current));
  });

  // ---------------------------------------------------------------- rooms

  /** Public rooms, most lively first. */
  app.get("/:lang/rooms", async (c) => {
    const dir = c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName("directory"));
    return c.json(await dir.list(c.get("L").meta.lang), 200, { "cache-control": "no-store" });
  });

  app.post("/:lang/rooms", async (c) => {
    const { name, visibility, level } = await c.req.json<{ name?: string; visibility?: string; level?: string }>()
      .catch(() => ({} as { name?: string; visibility?: string; level?: string }));
    const lvl = gameData(c.env.DATA).level(c.get("L"), level);
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
      if (await stub.create(code, c.get("L").meta.lang, String(name ?? ""), visibility === "public" ? "public" : "private", lvl))
        return c.json({ code }, 201);
    }
    return c.json({ error: "no free code" }, 500);
  });

  app.use("/:lang/rooms/:code/*", async (c, next) => {
    if (!validCode(c.req.param("code").toUpperCase())) return c.json({ error: "not_found" }, 404);
    await next();
  });
  app.use("/:lang/rooms/:code", async (c, next) => {
    if (!validCode(c.req.param("code").toUpperCase())) return c.json({ error: "not_found" }, 404);
    await next();
  });
  const room = (c: { env: Env; req: { param: (k: "code") => string } }) =>
    c.env.ROOMS.get(c.env.ROOMS.idFromName(c.req.param("code").toUpperCase()));
  const reply = <T>(c: { json: (o: unknown, s?: number) => Response }, x: T) =>
    isError(x) ? c.json(x, ERROR_STATUS[x.error]) : c.json(x);

  app.get("/:lang/rooms/:code", async (c) => reply(c, await room(c).state()));

  app.post("/:lang/rooms/:code/join", async (c) => {
    const { name, token } = await c.req.json<{ name?: string; token?: string }>().catch(() => ({} as { name?: string; token?: string }));
    return reply(c, await room(c).join(String(name ?? ""), token));
  });

  app.post("/:lang/rooms/:code/guess", async (c) => {
    const { token, w } = await c.req.json<{ token: string; w: string }>();
    return reply(c, await room(c).guess(token, w));
  });

  app.post("/:lang/rooms/:code/hint", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    return reply(c, await room(c).hint(token));
  });

  app.post("/:lang/rooms/:code/giveup", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    return reply(c, await room(c).giveUp(token));
  });

  app.post("/:lang/rooms/:code/rename", async (c) => {
    const { token, name } = await c.req.json<{ token: string; name: string }>();
    return reply(c, await room(c).rename(token, String(name ?? "")));
  });

  app.post("/:lang/rooms/:code/resume", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    return reply(c, await room(c).resume(token));
  });

  app.post("/:lang/rooms/:code/visibility", async (c) => {
    const { token, visibility } = await c.req.json<{ token: string; visibility: "public" | "private" }>();
    return reply(c, await room(c).setVisibility(token, visibility));
  });

  app.get("/:lang/rooms/:code/mine", async (c) =>
    reply(c, await room(c).mine(c.req.query("token") ?? "", c.req.query("round") ? c.get("n") : undefined)));

  app.get("/:lang/rooms/:code/reveal", async (c) =>
    reply(c, await room(c).reveal(c.req.query("token") ?? "", c.get("n"))));

  app.get("/:lang/rooms/:code/ws", (c) => room(c).fetch(c.req.raw));

  return app;
}
