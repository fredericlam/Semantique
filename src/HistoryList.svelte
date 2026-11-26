<script lang="ts">
  import type { GameState } from "./lib/game.ts";

  let { items, label, status, current, onplay }: {
    items: { round: number; word: string; found?: number }[];
    label: (round: number) => string;
    status: ((round: number) => GameState) | null; // null in a room: results live on the server
    current: number;
    onplay: (round: number) => void;
  } = $props();

  let open = $state(false);
  let revealed = $state(new Set<number>());
  const shown = $derived(open ? items : items.slice(0, 6));

  function reveal(n: number) {
    revealed = new Set(revealed).add(n);
  }
</script>

{#if items.length}
  <section class="history">
    <h2>les mots précédents</h2>
    <ul>
      {#each shown as it (it.round)}
        {@const s = status?.(it.round)}
        {@const done = s && s.status !== "playing"}
        {@const tries = s ? s.guesses.filter((g) => !g.hint).length : 0}
        <li>
          <span class="hour">{label(it.round)}</span>
          {#if done || revealed.has(it.round)}
            <span class="word">{it.word}</span>
          {:else}
            <button class="word hidden" onclick={() => reveal(it.round)} title="Toucher pour révéler">{it.word}</button>
          {/if}
          <span class="found" title="Nombre de personnes qui ont trouvé ce mot">🎯 {it.found ?? 0}</span>
          <span class="res">
            {#if s?.status === "won"}🎯 en {tries}
            {:else if s?.status === "gaveup"}🏳️ abandon
            {:else if s && s.guesses.length}⏸ {tries} essai{tries > 1 ? "s" : ""}
            {:else if status}<span class="muted">pas joué</span>{/if}
          </span>
          {#if !done && it.round < current}
            <button class="play" onclick={() => onplay(it.round)}>jouer</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if items.length > 6}
      <button class="more" onclick={() => (open = !open)}>{open ? "voir moins" : `voir les ${items.length} derniers mots`}</button>
    {/if}
  </section>
{/if}

<style>
  .history h2 { font-family: var(--script); font-weight: 400; font-size: 2rem; color: var(--pink); margin: 1.8rem 0 0.5rem; text-shadow: 1px 1px 0 var(--ink); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li {
    display: grid; grid-template-columns: 4.6rem minmax(0, 1fr) auto auto auto; align-items: center; gap: 0.5rem;
    background: var(--panel); border: 2px solid var(--line); border-radius: 12px; padding: 0.45rem 0.7rem;
  }
  .hour { font-family: var(--mono); font-size: 0.78rem; font-weight: 700; color: var(--muted); white-space: nowrap; }
  .word { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .word.hidden { border: 0; background: var(--panel-2); border-radius: 6px; padding: 0.05rem 0.4rem; filter: blur(5px); cursor: pointer; font: inherit; font-weight: 800; color: var(--ink); width: fit-content; }
  .word.hidden:hover { filter: blur(3px); }
  .res { font-size: 0.82rem; white-space: nowrap; }
  .muted { color: var(--muted); }
  .play { background: var(--pink); color: white; border: 2px solid var(--line); border-radius: 8px; padding: 0.15rem 0.6rem; font-size: 0.78rem; font-weight: 700; }
  .more { display: block; margin: 0.7rem auto 0; background: none; border: 0; font-weight: 700; color: var(--pink); }
  .found { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
  @media (max-width: 380px) { li { grid-template-columns: 3.4rem minmax(0, 1fr) auto auto auto; gap: 0.35rem; } }
</style>
