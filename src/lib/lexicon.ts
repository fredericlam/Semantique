/** Client-side word handling: input normalisation, suggestions, reduced vectors. Nothing secret here. */

export interface Lexicon {
  words: string[];
  index: Map<string, number>;
  forms: Record<string, number>;
  loose: Record<string, number[]>;
  vec: Int8Array;
  dims: number;
}

export type Resolution =
  | { kind: "ok"; id: number; word: string; alts: string[] }
  | { kind: "unknown"; suggestions: string[] };

export async function loadLexicon(lang: string, dims: number, version: string): Promise<Lexicon> {
  const url = (f: string) => `/api/${lang}/public/${f}?v=${version}`;
  const [vocab, forms, vec] = await Promise.all([
    fetch(url("vocab.txt")).then((r) => r.text()),
    fetch(url("forms.json")).then((r) => r.json()),
    fetch(url("vec.bin")).then((r) => r.arrayBuffer()),
  ]);
  const words = vocab.split("\n").filter(Boolean);
  return { words, index: new Map(words.map((w, i) => [w, i])), forms: forms.forms, loose: forms.loose, vec: new Int8Array(vec), dims };
}

export const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");

export function clean(input: string): string {
  return input.trim().toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, " ");
}

export function resolve(lex: Lexicon, input: string): Resolution {
  const s = clean(input);
  const tries = [s, s.replace(/œ/g, "oe").replace(/æ/g, "ae")];
  for (const t of tries) {
    const id = lex.index.get(t) ?? lex.forms[t];
    if (id !== undefined) return { kind: "ok", id, word: lex.words[id], alts: [] };
  }
  const ids = lex.loose[stripAccents(tries[1])];
  if (ids?.length) return { kind: "ok", id: ids[0], word: lex.words[ids[0]], alts: ids.slice(1, 4).map((i) => lex.words[i]) };
  return { kind: "unknown", suggestions: suggest(lex, s) };
}

/** Closest known words by edit distance (accent-insensitive): nearest first, then most frequent. */
export function suggest(lex: Lexicon, input: string, max = 3): string[] {
  const s = stripAccents(input);
  const limit = s.length <= 4 ? 1 : 2;
  const found: [number, number][] = [];
  lex.words.forEach((w, i) => {
    if (Math.abs(w.length - s.length) > limit) return;
    const d = editDistance(s, stripAccents(w), limit);
    if (d <= limit) found.push([d, i]);
  });
  return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, max).map(([, i]) => lex.words[i]);
}

function editDistance(a: string, b: string, limit: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Cosine similarity between two words in the reduced space. */
export function similarity(lex: Lexicon, a: number, b: number): number {
  const d = lex.dims;
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < d; k++) {
    const x = lex.vec[a * d + k], y = lex.vec[b * d + k];
    dot += x * y; na += x * x; nb += y * y;
  }
  return dot / Math.sqrt(na * nb || 1);
}
