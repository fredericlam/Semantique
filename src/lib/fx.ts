/**
 * Little animations while playing: a corner sticker for each heat level (🧊 🌊 🌴 ☀️ 🥵 🔥),
 * a big celebration when the word is found, and (for Amélie and Lili) a Jude Bellingham-style wink.
 * Everything is plain DOM + CSS (see app.css, "fx"), removed once played. Reduced motion: calmer versions.
 */

// ------------------------------------------------------------------ sound switch (header button), remembered per device

const MUTE_KEY = "semantique:mute";
export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {}
}

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function el(tag: string, cls: string, html = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

// ------------------------------------------------------------------ corner sticker, one per heat level

type Kind = "ice" | "cool" | "mild" | "warm" | "hot" | "fire";

/** The sticker for a rank: one per level of the scale (🧊 🌊 🌴 ☀️ 🥵 🔥), none for the secret word itself. */
export function heatKind(rank: number): Kind | null {
  if (rank === 0) return null;
  if (rank <= 10) return "fire";
  if (rank <= 100) return "hot";
  if (rank <= 500) return "warm";
  if (rank <= 2000) return "mild";
  if (rank <= 8000) return "cool";
  return "ice";
}

const STICKERS: Record<Kind, { emoji: string; label: string; bits: string[] }> = {
  ice: { emoji: "🧊", label: "brrr…", bits: ["❄️", "❄️", "❄️", "❄️", "❄️", "❄️"] },
  cool: { emoji: "🌊", label: "frais", bits: ["🫧", "🫧", "🫧", "🫧", "🫧"] },
  mild: { emoji: "🌴", label: "tiède…", bits: ["🥥", "🍃", "🍃", "🥥"] },
  warm: { emoji: "☀️", label: "ça se réchauffe", bits: ["✨", "✨", "✨", "✨"] },
  hot: { emoji: "🥵", label: "ça chauffe !", bits: ["〰️", "〰️", "〰️", "☀️"] },
  fire: { emoji: "🔥", label: "ça brûle !!", bits: ["🔥", "🔥", "✨", "🔥", "✨", "🔥", "🔥"] },
};

/**
 * One sound per heat level, rising in intensity (synthesised: no audio file):
 * icy = a dull little "bonk", cool/mild = a plain ding, then from ☀️ it gets satisfying:
 * the "payment done" double ding, a bright arpeggio for 🥵, a sparkling chord for 🔥.
 * Web Audio follows the phone's silent switch on iOS, and the header mute button turns it all off.
 */
export function heatSound(kind: Kind) {
  if (isMuted()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); // the 🔥 chord stacks many notes: keep it clean, no clipping
    out.connect(comp).connect(ctx.destination);
    /** A bell-ish note: fundamental + a few inharmonic partials, quick attack, natural decay. */
    const bell = (f: number, at: number, vol: number, len = 0.9, partials: readonly (readonly [number, number])[] = [[1, 1], [2.76, 0.25], [5.4, 0.08]]) => {
      for (const [mult, v] of partials) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(vol * v, t + at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + len / Math.sqrt(mult));
        o.connect(g).connect(out);
        o.start(t + at);
        o.stop(t + at + len + 0.05);
      }
    };
    let end = 1;
    switch (kind) {
      case "ice": { // dull, low, short: "bof"
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 600;
        o.type = "triangle";
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.18);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(lp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.25);
        end = 0.4;
        break;
      }
      case "cool": // a soft, low single tap
        bell(659.25, 0, 0.12, 0.45, [[1, 1], [2.76, 0.1]]); // E5
        end = 0.6;
        break;
      case "mild": // the plain, standard ding
        bell(987.77, 0, 0.15, 0.7); // B5
        break;
      case "warm": // ☀️ "payment done": two bright notes
        bell(1318.5, 0, 0.18); // E6
        bell(1975.5, 0.11, 0.17); // B6
        end = 1.2;
        break;
      case "hot": // 🥵 rising arpeggio, fuller
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(f, i * 0.075, 0.17, i === 3 ? 1.2 : 0.7)); // C6 E6 G6 C7
        end = 1.6;
        break;
      case "fire": { // 🔥 big sparkling chord + shimmer on top
        [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(f, i * 0.05, i < 3 ? 0.12 : 0.15, 1.6));
        for (let k = 0; k < 6; k++) bell(2637 + k * 220, 0.4 + k * 0.06, 0.05, 0.4, [[1, 1]]); // glitter
        end = 2.1;
        break;
      }
    }
    setTimeout(() => ctx.close(), end * 1000 + 300);
  } catch {}
}

export function corner(kind: Kind, opts: { sound?: boolean } = {}) {
  if (opts.sound) heatSound(kind);
  document.querySelector(".fx-corner")?.remove();
  const s = STICKERS[kind];
  const box = el("div", `fx-corner fx-${kind}`, `<span class="fx-glow"></span><span class="fx-emoji">${s.emoji}</span><span class="fx-label">${s.label}</span>`);
  if (!calm())
    s.bits.forEach((b, i) => {
      const bit = el("span", "fx-bit", b);
      bit.style.setProperty("--x", `${10 + Math.random() * 80}%`);
      bit.style.setProperty("--d", `${i * 110 + Math.random() * 80}ms`);
      bit.style.setProperty("--s", `${0.7 + Math.random() * 0.6}`);
      box.appendChild(bit);
    });
  document.body.appendChild(box);
  if (kind === "fire" && "vibrate" in navigator) try { navigator.vibrate([30, 40, 30]); } catch {}
  setTimeout(() => box.remove(), 2300);
}

// ------------------------------------------------------------------ the word is found

/** A short synthesised fanfare: rising arpeggio, then a sparkle. */
function fanfare() {
  if (isMuted()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === notes.length - 1 ? "sine" : "triangle";
      o.frequency.value = f;
      const at = t + i * 0.09, len = i === notes.length - 1 ? 0.7 : 0.22;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + len + 0.05);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

const COLORS = ["#ff3d8b", "#2dd4bf", "#ff9f5a", "#ffd166", "#a78bfa", "#ffffff"];

interface Bit { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; life: number; spark: boolean }

/** Confetti from both bottom corners + three firework bursts, on one canvas. */
function confetti(duration = 3800) {
  const cv = document.createElement("canvas");
  cv.className = "fx-canvas";
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  document.body.appendChild(cv);
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const bits: Bit[] = [];
  const paper = (x: number, y: number, angle: number, speed: number) =>
    bits.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 8, c: COLORS[(Math.random() * COLORS.length) | 0], life: 1, spark: false,
    });
  const burst = (x: number, y: number) => {
    const c = COLORS[(Math.random() * 5) | 0];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2, s = 3 + Math.random() * 3.5;
      bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 0, vr: 0, w: 2.6, h: 2.6, c, life: 1, spark: true });
    }
  };
  for (let i = 0; i < 90; i++) {
    paper(0, H, -Math.PI / 3 - Math.random() * 0.5, 9 + Math.random() * 9);
    paper(W, H, -Math.PI + Math.PI / 3 + Math.random() * 0.5, 9 + Math.random() * 9);
  }
  const fireworks = [[0.3, 0.28, 250], [0.72, 0.22, 650], [0.5, 0.36, 1050]] as const;
  const timers = fireworks.map(([fx, fy, d]) => setTimeout(() => burst(W * fx, H * fy), d));
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    g.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += b.spark ? 0.06 : 0.22;
      b.vx *= b.spark ? 0.97 : 0.985;
      b.vy *= b.spark ? 0.97 : 0.985;
      b.x += b.vx + (b.spark ? 0 : Math.sin((t + b.r * 100) / 180) * 0.6);
      b.y += b.vy;
      b.r += b.vr;
      if (b.spark) b.life -= 0.012;
      if (t > duration - 700) b.life -= 0.03;
      if (b.life <= 0) continue;
      g.globalAlpha = Math.max(0, b.life);
      g.fillStyle = b.c;
      if (b.spark) {
        g.beginPath();
        g.arc(b.x, b.y, b.w, 0, Math.PI * 2);
        g.fill();
      } else {
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.r);
        g.fillRect(-b.w / 2, (-b.h / 2) * Math.abs(Math.cos(b.r * 2)), b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
        g.restore();
      }
    }
    if (t < duration) requestAnimationFrame(frame);
    else { timers.forEach(clearTimeout); cv.remove(); }
  };
  requestAnimationFrame(frame);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The big one: flash, confetti, fireworks, a neon stamp with the word, a fanfare. */
export function celebrate(word: string, opts: { tries: number; sweetheart?: string | null }) {
  document.querySelector(".fx-corner")?.remove();
  const overlay = el("div", "fx-win", `
    <span class="fx-flash"></span>
    <span class="fx-rays"></span>
    <div class="fx-stamp">
      <span class="fx-kicker">🎯 trouvé !</span>
      <span class="fx-word">${escape(word)}</span>
      <span class="fx-tries">en ${opts.tries} essai${opts.tries > 1 ? "s" : ""}</span>
    </div>`);
  document.body.appendChild(overlay);
  if (!calm()) confetti();
  fanfare();
  if ("vibrate" in navigator) try { navigator.vibrate([60, 50, 60, 50, 140]); } catch {}
  setTimeout(() => overlay.remove(), opts.sweetheart ? 5200 : 3600);
  if (opts.sweetheart) setTimeout(() => jude(opts.sweetheart!), 1100);
}

// ------------------------------------------------------------------ 🙌 Jude-style celebration, for Amélie and Lili

/** A little footballer in a white #5 shirt, standing still with arms wide open — the famous pose. */
const PLAYER_SVG = `
<svg viewBox="0 0 160 190" aria-hidden="true">
  <g class="fx-arm fx-arm-l"><rect x="22" y="58" width="56" height="15" rx="7.5" fill="#fff" stroke="#1d1b2e" stroke-width="3"/><circle cx="24" cy="65.5" r="8" fill="#c68a5a" stroke="#1d1b2e" stroke-width="3"/></g>
  <g class="fx-arm fx-arm-r"><rect x="82" y="58" width="56" height="15" rx="7.5" fill="#fff" stroke="#1d1b2e" stroke-width="3"/><circle cx="136" cy="65.5" r="8" fill="#c68a5a" stroke="#1d1b2e" stroke-width="3"/></g>
  <rect x="58" y="126" width="17" height="46" rx="6" fill="#c68a5a" stroke="#1d1b2e" stroke-width="3"/>
  <rect x="85" y="126" width="17" height="46" rx="6" fill="#c68a5a" stroke="#1d1b2e" stroke-width="3"/>
  <rect x="54" y="168" width="24" height="12" rx="5" fill="#1d1b2e"/>
  <rect x="82" y="168" width="24" height="12" rx="5" fill="#1d1b2e"/>
  <path d="M55 118 h50 v20 h-50 z" fill="#fff" stroke="#1d1b2e" stroke-width="3"/>
  <path d="M58 54 q22 -10 44 0 l6 66 h-56 z" fill="#fff" stroke="#1d1b2e" stroke-width="3"/>
  <path d="M70 54 q10 8 20 0" fill="none" stroke="#d4a017" stroke-width="3"/>
  <text x="80" y="100" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="30" fill="#d4a017" stroke="#1d1b2e" stroke-width="1">5</text>
  <circle cx="80" cy="32" r="19" fill="#c68a5a" stroke="#1d1b2e" stroke-width="3"/>
  <path d="M62 27 q18 -20 36 0 q-4 -16 -18 -16 q-14 0 -18 16z" fill="#1d1b2e"/>
  <path d="M72 37 q8 6 16 0" fill="none" stroke="#1d1b2e" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="73" cy="30" r="2.2" fill="#1d1b2e"/>
  <circle class="fx-eye" cx="87" cy="30" r="2.2" fill="#1d1b2e"/>
  <path class="fx-wink" d="M84 31 q3 -3 6 0" fill="none" stroke="#1d1b2e" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

export function jude(name: string) {
  document.querySelector(".fx-jude")?.remove();
  const box = el("div", "fx-jude", `
    <div class="fx-bubble">Hey ${escape(name)} ! 🙌<small>célébration à la Jude</small></div>
    <div class="fx-player">${PLAYER_SVG}</div>
    <span class="fx-spot"></span>`);
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4300);
}
