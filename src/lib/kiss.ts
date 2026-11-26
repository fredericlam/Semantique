/** Easter egg 💋: for Amélie and Lili, tapping the logo sends hearts and a "smack". */

import { isMuted } from "./fx.ts";

const SWEETHEARTS = ["amelie", "lili"];

export const isSweetheart = (name: string | null | undefined) =>
  !!name && SWEETHEARTS.includes(name.normalize("NFD").replace(/\p{Mn}/gu, "").trim().toLowerCase());

/** A short kiss sound, synthesised (no audio file): a filtered noise burst + a little pop. */
function smack() {
  if (isMuted()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const t = ctx.currentTime;

    // lips parting: band-passed noise, very short
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    noise.connect(band).connect(ng).connect(ctx.destination);

    // the "pop"
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(og).connect(ctx.destination);

    noise.start(t);
    osc.start(t);
    osc.stop(t + 0.1);
    setTimeout(() => ctx.close(), 400);
  } catch {}
}

/** Hearts and a kiss flying out of `from`. */
export function kiss(from: HTMLElement) {
  smack();
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const emojis = ["💋", "❤️", "💖", "💕", "❤️", "💗", "😘", "❤️", "💞"];
  emojis.forEach((e, i) => {
    const el = document.createElement("span");
    el.className = "kiss-fly";
    el.textContent = e;
    // a burst all around the logo, slightly biased downwards (the logo sits at the top of the screen)
    const angle = ((i / emojis.length) * 360 + 20 + Math.random() * 25) * (Math.PI / 180);
    const dist = i === 0 ? 70 : 90 + Math.random() * 120;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    el.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    el.style.setProperty("--rot", `${Math.random() * 60 - 30}deg`);
    el.style.fontSize = i === 0 ? "3rem" : `${1.4 + Math.random()}rem`;
    el.style.animationDelay = `${i * 35}ms`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  });
  if ("vibrate" in navigator) try { navigator.vibrate(40); } catch {}
}
