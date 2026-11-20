/** Rooms: API calls, saved sessions, live connection. */
import type { Guess } from "./game.ts";

export interface PlayerRound {
  status: "playing" | "won" | "gaveup";
  tries: number;
  hints: number;
  best: number | null;
  finished: number | null;
  place: number | null;
}

export type Visibility = "public" | "private";

export interface Snapshot {
  code: string;
  name: string;
  visibility: Visibility;
  level: string;
  owner: string | null;
  round: number;
  players: { name: string; online: boolean; now: PlayerRound | null; points: number; wins: number }[];
}

export interface Session {
  code: string;
  name: string;
  token: string;
}

type Entry = Omit<Guess, "input" | "n">;
export type RoomGuess = Entry & { n: number; hint: boolean };

export const ROOM_ERRORS: Record<string, string> = {
  not_found: "Cette room n'existe pas (ou plus).",
  taken: "Ce nom est déjà pris dans la room.",
  bad_name: "Choisis un nom de 1 à 20 caractères.",
  auth: "Session expirée : rejoins la room à nouveau.",
  finished: "Tu as déjà fini cette manche.",
  no_hint: "Plus d'indice : tu as déjà le mot le plus proche.",
  locked: "Le mot sera révélé à la fin de l'heure.",
  forbidden: "Seul·e le créateur ou la créatrice de la room peut faire ça.",
  not_given_up: "Tu n'as pas abandonné cette manche.",
};

class RoomError extends Error {
  constructor(public code: string) {
    super(ROOM_ERRORS[code] ?? "Le serveur ne répond pas, réessaie.");
  }
}

async function call<T>(lang: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/${lang}/rooms${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: "network" }));
  if (!r.ok || data.error) throw new RoomError(data.error ?? "network");
  return data as T;
}

export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

export interface PublicRoom {
  code: string;
  name: string;
  level: string;
  players: number;
  online: number;
  found: number;
  round: number;
  lastActive: number;
}

export const listRooms = (lang: string) => call<PublicRoom[]>(lang, "");
export const createRoom = (lang: string, name: string, visibility: Visibility, level: string) =>
  call<{ code: string }>(lang, "", { name, visibility, level });
export const roomRename = (lang: string, s: Session, name: string) =>
  call<{ token: string; name: string }>(lang, `/${s.code}/rename`, { token: s.token, name });
export const roomResume = (lang: string, s: Session) => call<{ ok: true }>(lang, `/${s.code}/resume`, { token: s.token });
export const roomSetVisibility = (lang: string, s: Session, visibility: Visibility) =>
  call<{ ok: true }>(lang, `/${s.code}/visibility`, { token: s.token, visibility });
export const joinRoom = (lang: string, code: string, name: string, token?: string) =>
  call<{ token: string; name: string }>(lang, `/${code}/join`, { name, token });
export const roomState = (lang: string, code: string) => call<Snapshot>(lang, `/${code}`);
export const roomGuess = (lang: string, s: Session, w: string) => call<RoomGuess>(lang, `/${s.code}/guess`, { token: s.token, w });
export const roomHint = (lang: string, s: Session) => call<RoomGuess>(lang, `/${s.code}/hint`, { token: s.token });
export const roomGiveUp = (lang: string, s: Session) => call<{ ok: true }>(lang, `/${s.code}/giveup`, { token: s.token });
export const roomMine = (lang: string, s: Session, round: number) =>
  call<{ round: number; guesses: RoomGuess[]; status: PlayerRound["status"] }>(lang, `/${s.code}/mine?token=${s.token}&round=${round}`);
export const roomReveal = (lang: string, s: Session, round: number) =>
  call<{ top: Entry[]; players: { name: string; guesses: RoomGuess[] }[] }>(lang, `/${s.code}/reveal?token=${s.token}&round=${round}`);

// ------------------------------------------------------------------ saved sessions (per browser)

const KEY = "semantique:rooms";

interface SavedRoom {
  name: string; // my player name in that room
  token: string;
  roomName?: string; // last known room name / level, to show the list offline
  level?: string;
  seen?: number; // last time I was in it
}

function saved(): Record<string, SavedRoom> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const savedSession = (code: string): Session | null => {
  const s = saved()[code];
  return s ? { code, name: s.name, token: s.token } : null;
};

/** Rooms I created or joined on this device, most recent first. */
export function myRooms(): (SavedRoom & { code: string })[] {
  return Object.entries(saved())
    .map(([code, r]) => ({ code, ...r }))
    .sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0));
}

/** Remember the room's name/level next to my session (for the "mes rooms" list). */
export function rememberRoom(code: string, info: { roomName: string; level: string }) {
  try {
    const all = saved();
    if (all[code]) all[code] = { ...all[code], ...info, seen: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** Drop a room from this device entirely (its token too: the player name can't be reclaimed). */
export function forgetRoom(code: string) {
  try {
    const all = saved();
    delete all[code];
    localStorage.setItem(KEY, JSON.stringify(all));
    if (localStorage.getItem("semantique:room") === code) localStorage.removeItem("semantique:room");
  } catch {}
}

export function saveSession(s: Session | null, forget?: string) {
  try {
    const all = saved();
    if (s) all[s.code] = { ...all[s.code], name: s.name, token: s.token, seen: Date.now() };
    if (forget) {
      localStorage.removeItem("semantique:room");
    } else if (s) localStorage.setItem("semantique:room", s.code);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export const lastRoom = (): string | null => {
  try {
    return localStorage.getItem("semantique:room");
  } catch {
    return null;
  }
};

export const lastName = (): string => Object.values(saved()).at(-1)?.name ?? "";

// ------------------------------------------------------------------ live connection

export function connect(
  lang: string,
  s: Session,
  on: { snapshot: (snap: Snapshot) => void; event: (text: string) => void; status: (online: boolean) => void },
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let ping: ReturnType<typeof setInterval>;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/api/${lang}/rooms/${s.code}/ws?token=${s.token}`);
    ws.onopen = () => {
      retry = 0;
      on.status(true);
      ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25_000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const msg = JSON.parse(e.data);
      if (msg.type === "snapshot" && msg.snapshot) on.snapshot(msg.snapshot);
      if (msg.type === "event") on.event(msg.text);
    };
    ws.onclose = () => {
      clearInterval(ping);
      on.status(false);
      if (!closed) setTimeout(open, Math.min(15_000, 1000 * 2 ** retry++));
    };
  };
  open();

  const wake = () => {
    if (document.visibilityState === "visible" && ws?.readyState === WebSocket.CLOSED) open();
  };
  document.addEventListener("visibilitychange", wake);
  return () => {
    closed = true;
    document.removeEventListener("visibilitychange", wake);
    clearInterval(ping);
    ws?.close();
  };
}
