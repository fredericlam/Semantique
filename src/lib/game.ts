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
}

// ------------------------------------------------------------------ API

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
}

export const fetchMeta = (lang: string) => api<Meta>(`/api/${lang}/meta`);
export const fetchGuess = (lang: string, round: number, word: string) =>
  api<Omit<Guess, "input" | "n">>(`/api/${lang}/guess?round=${round}&w=${encodeURIComponent(word)}`);
export const fetchHint = (lang: string, round: number, rank: number) =>
  api<Omit<Guess, "input" | "n">>(`/api/${lang}/hint?round=${round}&rank=${rank}`);
/** Nearest words: the server only answers for past rounds, or with the found word as proof. */
export const fetchTop = (lang: string, round: number, found?: string) =>
  api<Omit<Guess, "input" | "n">[]>(`/api/${lang}/top?round=${round}&n=100${found ? `&found=${encodeURIComponent(found)}` : ""}`).catch(() => []);

// ------------------------------------------------------------------ persistence (per browser)

const key = (lang: string, round: number) => `semantique:${lang}:r${round}`;

export function loadState(lang: string, round: number): GameState {
  try {
    const s = localStorage.getItem(key(lang, round));
    if (s) return JSON.parse(s);
  } catch {}
  return { guesses: [], status: "playing" };
}

export function saveState(lang: string, round: number, s: GameState): void {
  try {
    localStorage.setItem(key(lang, round), JSON.stringify(s));
  } catch {}
}

export interface Stats {
  played: number;
  won: number;
  today: number; // found in the last 24 rounds
  avgTries: number | null;
  bestTries: number | null;
}

export function computeStats(lang: string, current: number): Stats {
  let played = 0, won = 0, today = 0, tries = 0, bestTries: number | null = null;
  for (let r = 1; r <= current; r++) {
    const s = loadState(lang, r);
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
 * Next hint target: first a word in the top 1000, then each hint ~4x closer than the best word so far.
 * null when nothing closer than the best guess is left (except the secret itself).
 */
export function nextHintRank(guesses: Guess[]): number | null {
  const best = Math.min(...guesses.map((g) => g.rank), Infinity);
  if (best <= 1) return null;
  const known = new Set(guesses.map((g) => g.rank));
  let r = best > 1000 ? 1000 : Math.max(1, Math.floor(best / 4));
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
