import { similarity, type Lexicon } from "./lexicon.ts";

export interface Guess {
  id: number;
  word: string;
  input: string; // what was typed, if different from word
  cos: number;
  rank: number;
  n: number; // order of entry, 1-based
  hint?: boolean;
}

export interface GameState {
  guesses: Guess[];
  status: "playing" | "won" | "gaveup";
}

export interface Meta {
  lang: string;
  current: number;
  period: number;
  start: string;
  currentStart: string;
  nextAt: string;
  vocabSize: number;
  vecDims: number;
  credits: string[];
  version: string;
  levels: string[];
  defaultLevel: string;
}

/** icon: Phosphor icon (UI); emoji: same idea for plain text (share message). */
export const LEVEL_INFO: Record<string, { label: string; icon: "backpack" | "headphones" | "coffee"; emoji: string; hint: string }> = {
  kid: { label: "kid", icon: "backpack", emoji: "🎒", hint: "7–11 ans : des mots concrets du quotidien" },
  teen: { label: "teen", icon: "headphones", emoji: "🎧", hint: "ados : des mots courants" },
  adult: { label: "adulte", icon: "coffee", emoji: "☕", hint: "mots plus rares, plus abstraits" },
};
/** Plain-text label, with emoji (share message). */
export const levelLabel = (l: string) => `${LEVEL_INFO[l]?.emoji ?? ""} ${LEVEL_INFO[l]?.label ?? l}`.trim();

// ------------------------------------------------------------------ API

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export const fetchMeta = (lang: string) => api<Meta>(`/api/${lang}/meta`);
export const fetchGuess = (lang: string, level: string, round: number, word: string) =>
  api<Omit<Guess, "input" | "n">>(`/api/${lang}/guess?level=${level}&round=${round}&w=${encodeURIComponent(word)}`);
export const fetchHint = (lang: string, level: string, round: number, rank: number) =>
  api<Omit<Guess, "input" | "n">>(`/api/${lang}/hint?level=${level}&round=${round}&rank=${rank}`);
/** Nearest words: the server only answers for past rounds, or with the found word as proof. */
export const fetchTop = (lang: string, level: string, round: number, found?: string) =>
  api<Omit<Guess, "input" | "n">[]>(`/api/${lang}/top?level=${level}&round=${round}&n=100${found ? `&found=${encodeURIComponent(found)}` : ""}`).catch(() => []);

/** Secret words of the last finished rounds (never the current one). */
export const fetchHistory = (lang: string, level: string) =>
  api<{ round: number; word: string }[]>(`/api/${lang}/history?level=${level}`).catch(() => []);

// ------------------------------------------------------------------ persistence (per browser)

// adult keeps the original keys, so games played before levels existed are still there
const key = (lang: string, level: string, round: number) =>
  level === "adult" ? `semantique:${lang}:r${round}` : `semantique:${lang}:${level}:r${round}`;

export function loadState(lang: string, level: string, round: number): GameState {
  try {
    const s = localStorage.getItem(key(lang, level, round));
    if (s) return JSON.parse(s);
  } catch {}
  return { guesses: [], status: "playing" };
}

export function saveState(lang: string, level: string, round: number, s: GameState): void {
  try {
    localStorage.setItem(key(lang, level, round), JSON.stringify(s));
  } catch {}
}

export interface Stats {
  played: number;
  won: number;
  today: number; // found in the last 24 rounds
  avgTries: number | null;
  bestTries: number | null;
}

export function computeStats(lang: string, level: string, current: number): Stats {
  let played = 0, won = 0, today = 0, tries = 0, bestTries: number | null = null;
  for (let r = 1; r <= current; r++) {
    const s = loadState(lang, level, r);
    if (s.status === "playing") continue;
    played++;
    if (s.status === "won") {
      const t = s.guesses.filter((g) => !g.hint).length;
      won++;
      tries += t;
      bestTries = bestTries === null ? t : Math.min(bestTries, t);
      if (r > current - 24) today++;
    }
  }
  return { played, won, today, avgTries: won ? Math.round(tries / won) : null, bestTries };
}

// ------------------------------------------------------------------ hints

/**
 * Next hint target: first a word in the top 1000 (kids: top 300), then each hint ~4x (kids: ~3x) closer
 * than the best word so far; null when nothing closer is left. Keep in sync with server/data.ts.
 */
export function nextHintRank(guesses: Guess[], level = "adult"): number | null {
  const best = Math.min(...guesses.map((g) => g.rank), Infinity);
  if (best <= 1) return null;
  const known = new Set(guesses.map((g) => g.rank));
  const [first, factor] = level === "kid" ? [300, 3] : [1000, 4];
  let r = best > first ? first : Math.max(1, Math.floor(best / factor));
  while (r >= 1 && known.has(r)) r--;
  return r >= 1 ? r : null;
}

// ------------------------------------------------------------------ grouping guesses into "tracks"

export interface Track {
  leader: Guess; // hottest word of the group
  members: Guess[];
}

const TRACK_THRESHOLD = 0.55;

/** Greedy grouping: hottest guesses first, each joins the closest existing track (centroid) if similar enough. */
export function buildTracks(lex: Lexicon, guesses: Guess[]): Track[] {
  const sorted = [...guesses].sort((a, b) => a.rank - b.rank);
  const tracks: Track[] = [];
  for (const g of sorted) {
    let best: Track | null = null, bestSim = TRACK_THRESHOLD;
    for (const t of tracks) {
      const sim = t.members.reduce((s, m) => s + similarity(lex, g.id, m.id), 0) / t.members.length;
      if (sim > bestSim) { bestSim = sim; best = t; }
    }
    if (best) best.members.push(g);
    else tracks.push({ leader: g, members: [g] });
  }
  return tracks;
}
