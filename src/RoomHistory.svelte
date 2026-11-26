<script lang="ts">
  /** Past rounds of the room, compact: date, word, who found it in how many tries, each player's 10 closest words, the rest folded. */
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

  const ord = (n: number) => (n === 1 ? "1er" : `${n}e`);
</script>

{#if rounds.length}
  <section class="past">
    <h2>les parties précédentes</h2>
    {#each rounds as r (r.round)}
      {@const winners = r.players.filter((p) => p.status === "won").length}
      <article class="game">
        <header>
          <span class="when">{label(r.round)}</span>
          <span class="word">{r.word ?? "?"}</span>
          <span class="found">🎯 {winners}/{r.players.length}</span>
        </header>
        {#each r.players as p (p.name)}
          {@const rest = p.guesses.slice(SHOWN)}
          <div class="player" class:me={p.name === me}>
            <p class="who">
              <strong>{p.name}</strong>
              {#if p.status === "won"}<span class="res win">🎯 {ord(p.place ?? 1)} · {p.tries} coup{p.tries > 1 ? "s" : ""}{p.hints ? ` · ${p.hints}💡` : ""}</span>
              {:else if p.status === "gaveup"}<span class="res">🏳️ abandon · {p.tries} coup{p.tries > 1 ? "s" : ""}</span>
              {:else}<span class="res">pas trouvé · {p.tries} coup{p.tries > 1 ? "s" : ""}</span>{/if}
            </p>
            <p class="chips">
              {#each p.guesses.slice(0, SHOWN) as g (g.word)}
                <span class="chip" class:hit={g.rank === 0} title={`n°${g.rank}`}>{level(g.rank).emoji} {g.word}{g.hint ? " 💡" : ""}</span>
              {/each}
            </p>
            {#if rest.length}
              <details class="rest">
                <summary>+{rest.length} autre{rest.length > 1 ? "s" : ""} mot{rest.length > 1 ? "s" : ""}</summary>
                <p>{rest.map((g) => g.word).join(" · ")}</p>
              </details>
            {/if}
          </div>
        {/each}
      </article>
    {/each}
    {#if more}
      <button class="more" disabled={busy} onclick={() => load(rounds.at(-1)?.round)}>{busy ? "…" : "parties plus anciennes"}</button>
    {/if}
  </section>
{/if}

<style>
  .past h2 { font-family: var(--script); font-weight: 400; font-size: 2rem; color: var(--pink); margin: 1.8rem 0 0.5rem; text-shadow: 1px 1px 0 var(--ink); }
  .game { background: var(--panel); border: 2px solid var(--line); border-radius: 12px; padding: 0.5rem 0.7rem 0.4rem; margin-bottom: 8px; }
  header { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.3rem; }
  .when { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
  .word { flex: 1; min-width: 0; font-weight: 800; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .found { font-size: 0.78rem; white-space: nowrap; }
  .player { padding: 0.3rem 0; border-top: 1px dashed color-mix(in srgb, var(--line) 35%, transparent); }
  .player.me .who strong { color: var(--pink); }
  .who { margin: 0 0 0.2rem; display: flex; align-items: baseline; gap: 0.45rem; font-size: 0.88rem; }
  .res { font-size: 0.76rem; color: var(--muted); white-space: nowrap; }
  .res.win { color: var(--pink); font-weight: 700; }
  .chips { margin: 0; display: flex; flex-wrap: wrap; gap: 3px; }
  .chip { font-size: 0.74rem; background: var(--panel-2); border-radius: 99px; padding: 0.05rem 0.45rem; white-space: nowrap; }
  .chip.hit { background: var(--pink); color: white; font-weight: 700; }
  .rest { margin-top: 0.2rem; }
  .rest summary { font-size: 0.7rem; color: var(--muted); cursor: pointer; width: fit-content; }
  .rest p { margin: 0.15rem 0 0; font-size: 0.66rem; line-height: 1.35; color: var(--muted); }
  .more { display: block; margin: 0.4rem auto 0; background: none; border: 0; color: var(--muted); font-weight: 700; font-size: 0.82rem; text-decoration: underline; cursor: pointer; }
</style>
