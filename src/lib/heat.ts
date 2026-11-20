/** One readable scale, derived from the rank (0 = secret word) — gives a gradient from the very first guess. */

import type { IconName } from "./icons.ts";

export interface Level {
  maxRank: number;
  label: string;
  icon: IconName; // pixel icon shown in the UI
  color: string;
  emoji: string; // only for the shared text, where icons can't go
}

export const LEVELS: Level[] = [
  { maxRank: 0, label: "trouvé", icon: "target", color: "#d628c8", emoji: "🎯" },
  { maxRank: 10, label: "brûlant", icon: "fire", color: "#ff3d8b", emoji: "🔥" },
  { maxRank: 100, label: "très chaud", icon: "sun-solid", color: "#ff6a3d", emoji: "🥵" },
  { maxRank: 500, label: "chaud", icon: "sun", color: "#f59e0b", emoji: "☀️" },
  { maxRank: 2000, label: "tiède", icon: "cloud-sun", color: "#e88a6a", emoji: "🌤️" },
  { maxRank: 8000, label: "frais", icon: "waves", color: "#12a9b8", emoji: "🌊" },
  { maxRank: Infinity, label: "froid", icon: "snowflake", color: "#4f8dff", emoji: "🧊" },
];

export const level = (rank: number) => LEVELS.find((l) => rank <= l.maxRank)!;

/** 0–100, logarithmic in rank. */
export function heat(rank: number, vocabSize: number): number {
  if (rank === 0) return 100;
  return Math.max(0, 100 * (1 - Math.log(rank + 1) / Math.log(vocabSize)));
}

/** What players see: a temperature in °C, 100° = the secret word. */
export const temperature = heat;

// pool teal → peach → sunset orange → neon pink
const STOPS: [number, [number, number, number]][] = [
  [0, [18, 194, 196]],
  [30, [120, 214, 200]],
  [45, [255, 190, 140]],
  [65, [255, 140, 90]],
  [85, [255, 61, 139]],
  [100, [214, 40, 200]],
];

export function heatColor(h: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    const [h1, c1] = STOPS[i];
    if (h <= h1) {
      const [h0, c0] = STOPS[i - 1];
      const t = (h - h0) / (h1 - h0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c.join(" ")})`;
    }
  }
  return `rgb(${STOPS.at(-1)![1].join(" ")})`;
}
