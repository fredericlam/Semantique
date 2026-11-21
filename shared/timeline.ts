/**
 * When each round (secret word) starts. Shared by the Worker and the app so both always agree.
 *
 * The rhythm changed over time; each era starts where the previous one stops, so rounds already
 * played keep their number, word and results:
 *   1. from the start: one round per `period` (hourly)
 *   2. 21/11/2026 0h: day/night pattern (0h, 3h, 6h, then hourly 9h–23h)
 *   3. 21/11/2026 15h: one round every 3 hours (0h, 3h, 6h … 21h) — 8 words a day
 *
 * Each era must start on one of its own slots. Round tables are indexed by round number only,
 * so changing the rhythm never touches the data. To change it again, append an era (in the future).
 */

export interface Timeline {
  start: string; // ISO datetime of round 1
  period: number; // seconds per round in the first era
  timezone: string;
}

interface Era {
  from: string; // ISO datetime, on one of the era's slots
  slots: number[]; // start hours, in the game's time zone
}

export const ERAS: Era[] = [
  { from: "2026-11-21T00:00:00+01:00", slots: [0, 3, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { from: "2026-11-21T15:00:00+01:00", slots: [0, 3, 6, 9, 12, 15, 18, 21] },
];

/** Current rhythm, for texts: hours between two words. */
export const HOURS_PER_WORD = 3;

interface Parts { y: number; m: number; d: number; h: number }

function parts(t: number, tz: string): Parts {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
      .formatToParts(t).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}

/** UTC timestamp of a wall-clock time (y-m-d h:00) in `tz` (handles DST). */
function wallToUtc(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const offset = (t: number) => {
    const p = parts(t, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h) - Math.floor(t / 3_600_000) * 3_600_000;
  };
  const t1 = guess - offset(guess);
  return guess - offset(t1);
}

const dayIndex = (p: Parts) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;

/** Index of the slot in progress at hour h (last slot starting at or before h). */
const slotAt = (slots: number[], h: number) => {
  let i = 0;
  for (let k = 0; k < slots.length; k++) if (slots[k] <= h) i = k;
  return i;
};

/** Rounds of an era started at or before t (t ≥ era start). */
function eraCount(era: Era, t: number, tz: string): number {
  const s = parts(Date.parse(era.from), tz), p = parts(t, tz);
  const first = slotAt(era.slots, s.h);
  return (dayIndex(p) - dayIndex(s)) * era.slots.length + slotAt(era.slots, p.h) - first + 1;
}

/** Number of rounds played before each era begins. */
function eraBases(tl: Timeline): number[] {
  const bases: number[] = [];
  let prevEnd = Math.round((Date.parse(ERAS[0].from) - Date.parse(tl.start)) / (tl.period * 1000));
  bases.push(prevEnd);
  for (let i = 1; i < ERAS.length; i++) {
    prevEnd += eraCount(ERAS[i - 1], Date.parse(ERAS[i].from) - 1, tl.timezone);
    bases.push(prevEnd);
  }
  return bases;
}

/** Round in progress at `now` (1-based). */
export function roundAt(tl: Timeline, now = Date.now()): number {
  if (now < Date.parse(ERAS[0].from)) return Math.floor((now - Date.parse(tl.start)) / (tl.period * 1000)) + 1;
  const bases = eraBases(tl);
  let i = ERAS.length - 1;
  while (i > 0 && now < Date.parse(ERAS[i].from)) i--;
  return bases[i] + eraCount(ERAS[i], now, tl.timezone);
}

/** Start time (ms) of round n. */
export function roundStart(tl: Timeline, n: number): number {
  const bases = eraBases(tl);
  if (n <= bases[0]) return Date.parse(tl.start) + (n - 1) * tl.period * 1000;
  let i = ERAS.length - 1;
  while (i > 0 && n <= bases[i]) i--;
  const era = ERAS[i];
  const s = parts(Date.parse(era.from), tl.timezone);
  const k = n - bases[i] - 1 + slotAt(era.slots, s.h);
  const day = new Date(Date.UTC(s.y, s.m - 1, s.d + Math.floor(k / era.slots.length)));
  return wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), era.slots[k % era.slots.length], tl.timezone);
}
