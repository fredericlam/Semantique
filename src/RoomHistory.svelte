<script lang="ts">
  /** Past rounds of the room, folded: date + word (hidden unless I found it). Open: everyone's result, then the room's 10 closest words with who proposed each and at which try, the rest minified. */
  import { onMount } from "svelte";
  import { level } from "./lib/heat.ts";
  import { roomHistory, type PastRound, type Session } from "./lib/room.ts";

  let { lang, session, me, label }: { lang: string; session: Session; me: string; label: (round: number) => string } = $props();

  const SHOWN = 10;
  let rounds = $state<PastRound[]>([]);
  let more = $state(false);
  let busy = $state(false);

  async function load(before?: number) {
    busy = true;
    try {
      const r = await roomHistory(lang, session, before);
      rounds = before ? [...rounds, ...r.rounds] : r.rounds;
      more = r.more;
    } catch {
      // history is a bonus: stay quiet if it fails
    } finally {
      busy = false;
    }
  }

  onMount(() => { load(); });

  let revealed = $state(new Set<number>());
  const reveal = (n: number) => (revealed = new Set(revealed).add(n));
  /** The word shows only if I found it, or once I asked for it (opening the card shows everyone's words, so it reveals too). */
  const visible = (r: PastRound) => revealed.has(r.round) || r.players.some((p) => p.name === me && p.status === "won");

  const ord = (n: number) => (n === 1 ? "1er" : `${n}e`);
</script>

{#if rounds.length}
  <section class="past">
    <h2>les parties précédentes</h2>
    {#each rounds as r (r.round)}
      {@const winners = r.players.filter((p) => p.status === "won").length}
      <details class="game" ontoggle={(e) => (e.currentTarget as HTMLDetailsElement).open && reveal(r.round)}>
        <summary>
          <span class="when">{label(r.round)}</span>
          {#if visible(r)}
            <span class="word">{r.word ?? "?"}</span>
          {:else}
            <button class="word hidden" onclick={(e) => { e.preventDefault(); e.stopPropagation(); reveal(r.round); }} title="Toucher pour révéler">{r.word ?? "?"}</button>
          {/if}
          <span class="found">🎯 {winners}/{r.players.length}</span>
          <span class="chev" aria-hidden="true">▾</span>
        </summary>
        <p class="results">
          {#each r.players as p (p.name)}
            <span class="res" class:win={p.status === "won"} class:me={p.name === me}>
              {#if p.status === "won"}🎯{:else if p.status === "gaveup"}🏳️{:else}⏸{/if}
              <strong>{p.name}</strong>
              {#if p.status === "won"}{ord(p.place ?? 1)} · {/if}{p.tries} coup{p.tries > 1 ? "s" : ""}{p.hints ? ` · ${p.hints}💡` : ""}
            </span>
          {/each}
        </p>
        <ol class="words">
          {#each r.words.slice(0, SHOWN) as w (w.word)}
            <li class:hit={w.rank === 0}>
              <span class="w-rank mono">{w.rank === 0 ? "🎯" : `n°${w.rank}`}</span>
              <span class="w-word">{level(w.rank).emoji} {w.word}</span>
              <span class="w-by">
                {#each w.by as b, k (b.name)}{k ? ", " : ""}<span class:me={b.name === me}>{b.name}</span> <small>{b.hint ? "💡" : `coup ${b.n}`}</small>{/each}
              </span>
            </li>
          {/each}
        </ol>
        {#if r.words.length > SHOWN}
          {@const rest = r.words.slice(SHOWN)}
          <details class="rest">
            <summary>+{rest.length} autre{rest.length > 1 ? "s" : ""} mot{rest.length > 1 ? "s" : ""}</summary>
            <p>{rest.map((w) => w.word).join(" · ")}</p>
          </details>
        {/if}
      </details>
    {/each}
    {#if more}
      <button class="more" disabled={busy} onclick={() => load(rounds.at(-1)?.round)}>{busy ? "…" : "parties plus anciennes"}</button>
    {/if}
  </section>
{/if}

<style>
  .past h2 { font-family: var(--script); font-weight: 400; font-size: 2rem; color: var(--pink); margin: 1.8rem 0 0.5rem; text-shadow: 1px 1px 0 var(--ink); }
  .game { background: var(--panel); border: 2px solid var(--line); border-radius: 12px; padding: 0.5rem 0.7rem 0.4rem; margin-bottom: 8px; }
  .game { padding: 0.45rem 0.7rem; margin-bottom: 6px; }
  .game[open] { padding-bottom: 0.4rem; }
  summary { display: flex; align-items: baseline; gap: 0.5rem; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  .game[open] summary { margin-bottom: 0.3rem; }
  .chev { font-size: 0.75rem; color: var(--muted); transition: rotate 0.15s; }
  .game[open] .chev { rotate: 180deg; }
  .word.hidden { flex: 0 1 auto; background: var(--panel-2); border: 0; border-radius: 6px; padding: 0 0.4rem; color: transparent; text-shadow: 0 0 8px var(--ink); font: inherit; font-weight: 800; cursor: pointer; margin-right: auto; }
  .when { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
  .word { flex: 1; min-width: 0; font-weight: 800; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .found { font-size: 0.78rem; white-space: nowrap; }
  .results { margin: 0 0 0.35rem; display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: 0.76rem; color: var(--muted); }
  .results .res.win { color: var(--pink); }
  .results strong { color: var(--ink); }
  .results .me strong { color: var(--pink); }
  .words { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  .words li { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr) auto; align-items: baseline; gap: 0.4rem; padding: 0.15rem 0.3rem; border-radius: 6px; font-size: 0.82rem; }
  .words li:nth-child(odd) { background: var(--panel-2); }
  .words li.hit { background: var(--pink); color: white; }
  .words li.hit .w-rank, .words li.hit .w-by, .words li.hit small { color: white; }
  .w-rank { font-size: 0.68rem; color: var(--muted); }
  .w-word { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .w-by { font-size: 0.72rem; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 11rem; }
  .w-by .me { color: var(--pink); font-weight: 700; }
  .words li.hit .w-by .me { color: white; }
  .w-by small { color: var(--muted); }
  .rest { margin-top: 0.2rem; }
  .rest summary { font-size: 0.7rem; color: var(--muted); cursor: pointer; width: fit-content; }
  .rest p { margin: 0.15rem 0 0; font-size: 0.66rem; line-height: 1.35; color: var(--muted); }
  .more { display: block; margin: 0.4rem auto 0; background: none; border: 0; color: var(--muted); font-weight: 700; font-size: 0.82rem; text-decoration: underline; cursor: pointer; }
</style>
