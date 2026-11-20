/**
 * When each round (secret word) starts. Shared by the Worker and the app so both always agree.
 *
 * - Until SWITCH_AT: one round per `period` (the original hourly rhythm).
 * - From SWITCH_AT: a daily pattern of slots in the game's time zone — every 3 hours at night
 *   (0h, 3h, 6h, "il faut dormir"), then every hour from 9h to 23h: 18 rounds a day.
 *
 * Round tables are indexed by round number only, so changing the rhythm never touches the data.
 */
export const SWITCH_AT = "2026-11-21T00:00:00+01:00";
export const SLOTS = [0, 3, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

export interface Timeline {
  start: string; // ISO datetime of round 1
  period: number; // seconds per round before SWITCH_AT
  timezone: string;
}

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

/** Number of rounds played before the switch to the day/night rhythm. */
const legacyRounds = (tl: Timeline) => Math.max(0, Math.round((Date.parse(SWITCH_AT) - Date.parse(tl.start)) / (tl.period * 1000)));

/** Round in progress at `now` (1-based). */
export function roundAt(tl: Timeline, now = Date.now()): number {
  const sw = Date.parse(SWITCH_AT);
  if (now < sw) return Math.floor((now - Date.parse(tl.start)) / (tl.period * 1000)) + 1;
  const sp = parts(sw, tl.timezone), np = parts(now, tl.timezone);
  const days = dayIndex(np) - dayIndex(sp);
  let slot = 0;
  for (let i = 0; i < SLOTS.length; i++) if (SLOTS[i] <= np.h) slot = i;
  return legacyRounds(tl) + days * SLOTS.length + slot + 1;
}

/** Start time (ms) of round n. */
export function roundStart(tl: Timeline, n: number): number {
  const legacy = legacyRounds(tl);
  if (n <= legacy) return Date.parse(tl.start) + (n - 1) * tl.period * 1000;
  const k = n - legacy - 1;
  const sp = parts(Date.parse(SWITCH_AT), tl.timezone);
  const day = new Date(Date.UTC(sp.y, sp.m - 1, sp.d + Math.floor(k / SLOTS.length)));
  return wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SLOTS[k % SLOTS.length], tl.timezone);
}
