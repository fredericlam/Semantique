<script lang="ts">
  import { heat, heatColor, level } from "./lib/heat.ts";
  import type { Guess } from "./lib/game.ts";
  import Icon from "./Icon.svelte";

  let { g, vocabSize, flash = false, compact = false, big = false }:
    { g: Guess; vocabSize: number; flash?: boolean; compact?: boolean; big?: boolean } = $props();

  const h = $derived(heat(g.rank, vocabSize));
  const lv = $derived(level(g.rank));
</script>

<li
  class="row" class:flash class:compact class:big class:found={g.rank === 0}
  style:--fill="{Math.max(4, h)}%" style:--heat={heatColor(h)}
  title={`similarité ${g.cos.toFixed(2)}`}
>
  {#if !compact}<span class="n">{g.n}</span>{/if}
  <span class="word">
    <span class="w">{g.word}</span>
    {#if g.hint}<span class="tag">indice</span>{/if}
    {#if g.input}<span class="input">← {g.input}</span>{/if}
  </span>
  <span class="label"><Icon name={lv.icon} color={lv.color} size="1.2em" /><span class="lt">{lv.label}</span></span>
  <span class="temp">
    <span class="deg">{h === 100 ? "100" : h.toFixed(1).replace(".", ",")}°</span>
    {#if g.rank > 0}<span class="rank">n°{g.rank.toLocaleString("fr-FR")}</span>{/if}
  </span>
</li>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr) auto 4.6rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem 0.7rem 0.6rem;
    border-radius: 14px;
    list-style: none;
    background: var(--panel);
    overflow: hidden;
    isolation: isolate;
  }
  .row.compact { grid-template-columns: minmax(0, 1fr) auto 4.6rem; }
  /* the heat gauge, as a thick neon underline across the whole row */
  .row::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: 0;
    height: 5px;
    width: var(--fill);
    background: var(--heat);
    border-radius: 0 99px 99px 0;
    box-shadow: 0 0 10px var(--heat);
    transition: width 0.6s cubic-bezier(.2,.9,.3,1.2);
  }
  .row::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(90deg, color-mix(in srgb, var(--heat) 18%, transparent) var(--fill), transparent var(--fill));
  }
  .n { font-family: var(--mono); color: var(--muted); font-size: 0.75rem; text-align: right; }
  .word { min-width: 0; display: flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; }
  .w { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.01em; }
  .input { color: var(--muted); font-size: 0.78rem; }
  .tag {
    font-family: var(--mono); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em;
    background: var(--teal); color: #10233a; padding: 0.05rem 0.4rem; border-radius: 4px; transform: rotate(-3deg);
  }
  .label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.82rem; font-weight: 600; white-space: nowrap; }
  .temp { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
  .deg { font-family: var(--mono); font-weight: 700; font-size: 1.05rem; letter-spacing: -0.03em; }
  .rank { font-family: var(--mono); font-size: 0.66rem; color: var(--muted); }
  .big .deg { font-size: 1.35rem; }
  .row.found { background: linear-gradient(100deg, var(--sun-a), var(--pink)); color: #2a1440; }
  .row.found::after { display: none; }

  .big { padding: 0.8rem 0.9rem 0.95rem 0.7rem; border: 2px solid var(--line); box-shadow: var(--shadow); }
  .big .w { font-size: 1.3rem; }
  .big::after { height: 7px; }

  .flash { animation: wiggle 0.9s ease; }
  @keyframes wiggle {
    0%, 100% { transform: none; }
    20% { transform: rotate(-1.5deg) scale(1.02); background: var(--pink-soft); }
    40% { transform: rotate(1.2deg) scale(1.02); }
    60% { transform: rotate(-0.6deg); }
  }

  @media (max-width: 420px) {
    .lt { display: none; }
    .row:not(.big) .w { font-size: 1rem; }
  }
</style>
