<script lang="ts">
  import { heat, level } from "./lib/heat.ts";
  import type { Snapshot } from "./lib/room.ts";

  let { snap, me, vocabSize, connected, onshare, onleave, ontogglevisibility }:
    { snap: Snapshot; me: string; vocabSize: number; connected: boolean; onshare: () => void; onleave: () => void; ontogglevisibility: () => void } = $props();
  const isOwner = $derived(snap.owner === me);

  let tab = $state<"live" | "points">("live");

  const ord = (n: number) => (n === 1 ? "1er" : `${n}e`);

  /** This hour: winners by arrival, then players by best rank, then those who haven't started. */
  const live = $derived(
    [...snap.players].sort((a, b) => {
      const pa = a.now?.place ?? Infinity, pb = b.now?.place ?? Infinity;
      if (pa !== pb) return pa - pb;
      return (a.now?.best ?? Infinity) - (b.now?.best ?? Infinity);
    }),
  );
  const standings = $derived([...snap.players].sort((a, b) => b.points - a.points || b.wins - a.wins));
  const found = $derived(snap.players.filter((p) => p.now?.status === "won").length);
</script>

<section class="board">
  <span class="tape" aria-hidden="true"></span>
  <header>
    <div class="title">
      <span class="room-name">{snap.name}</span>
      <span class="meta-line">
        <span class="dot" class:on={connected} title={connected ? "en direct" : "reconnexion…"}></span>
        <span class="kicker">code</span> <span class="code">{snap.code}</span>
        {#if isOwner}
          <button class="vis" onclick={ontogglevisibility} title="Changer la visibilité (tu as créé cette room)">{snap.visibility === "public" ? "🌍 publique" : "🔒 privée"}</button>
        {:else}
          <span class="vis ro">{snap.visibility === "public" ? "🌍" : "🔒"}</span>
        {/if}
        <span class="actions">
          <button class="mini" onclick={onshare}>🔗 inviter</button>
          <button class="mini ghost" onclick={onleave} aria-label="Quitter la room">quitter</button>
        </span>
      </span>
    </div>
  </header>

  <div class="seg" role="tablist">
    <button role="tab" aria-selected={tab === "live"} onclick={() => (tab = "live")}>cette heure · {found}/{snap.players.length} 🎯</button>
    <button role="tab" aria-selected={tab === "points"} onclick={() => (tab = "points")}>classement</button>
  </div>

  {#if tab === "live"}
    <ul class="players">
      {#each live as p (p.name)}
        {@const n = p.now}
        <li class:me={p.name === me}>
          <span class="online" class:on={p.online} title={p.online ? "en ligne" : "hors ligne"}></span>
          <span class="name">{p.name}{#if p.name === me}<span class="you">toi</span>{/if}</span>
          {#if !n || (n.tries === 0 && n.hints === 0 && n.status === "playing")}
            <span class="stat muted">pas encore joué</span>
          {:else if n.status === "won"}
            <span class="stat win">🎯 {ord(n.place ?? 1)} · {n.tries} essai{n.tries > 1 ? "s" : ""}{n.hints ? ` · ${n.hints}💡` : ""}</span>
          {:else if n.status === "gaveup"}
            <span class="stat muted">🏳️ abandon</span>
          {:else}
            <span class="stat">{level(n.best ?? 99999).emoji} <strong>{heat(n.best ?? 99999, vocabSize).toFixed(1).replace(".", ",")}°</strong> · {n.tries} essai{n.tries > 1 ? "s" : ""}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <ol class="players points">
      {#each standings as p, i (p.name)}
        <li class:me={p.name === me}>
          <span class="pos">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
          <span class="name">{p.name}</span>
          <span class="stat"><strong>{p.points}</strong> pts · {p.wins} 🎯</span>
        </li>
      {/each}
    </ol>
    <p class="rules">5 / 3 / 2 pts aux 3 premiers à trouver, 1 pt ensuite, +1 sans indice.</p>
  {/if}
</section>

<style>
  .board {
    position: relative; background: var(--panel); border: 2px solid var(--line); border-radius: 6px;
    padding: 1rem 0.9rem 0.8rem; margin: 6px 0 14px; box-shadow: var(--shadow); rotate: -0.4deg;
  }
  .tape {
    position: absolute; top: -12px; left: 50%; width: 90px; height: 22px; translate: -50% 0; rotate: 2deg;
    background: repeating-linear-gradient(45deg, var(--tape) 0 8px, color-mix(in srgb, var(--tape) 70%, white) 8px 16px);
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .title { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; flex: 1; }
  .room-name { font-family: var(--script); font-size: 1.7rem; line-height: 1.05; color: var(--pink); text-shadow: 1px 1px 0 var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta-line { display: flex; align-items: center; gap: 0.35rem; }
  .kicker { font-family: var(--mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); }
  .code { font-family: var(--mono); font-weight: 700; font-size: 0.95rem; letter-spacing: 0.12em; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: blink 2s infinite; }
  @keyframes blink { 50% { opacity: 0.5; } }
  .actions { display: flex; gap: 0.35rem; margin-left: auto; }
  .vis { background: var(--panel-2); border: 0; border-radius: 99px; padding: 0.1rem 0.5rem; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  .vis.ro { background: none; padding: 0; }
  .mini { white-space: nowrap; background: var(--pink); color: white; border: 2px solid var(--line); border-radius: 99px; padding: 0.2rem 0.65rem; font-size: 0.8rem; font-weight: 700; }
  .mini.ghost { background: var(--panel); color: var(--ink); }

  .seg { display: flex; gap: 3px; padding: 3px; background: var(--panel-2); border-radius: 99px; margin-bottom: 0.5rem; }
  .seg button { flex: 1; border: 0; background: none; border-radius: 99px; padding: 0.3rem; font-size: 0.8rem; font-weight: 600; color: var(--muted); }
  .seg button[aria-selected="true"] { background: var(--ink); color: var(--panel); }

  .players { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .players li { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.4rem; border-radius: 8px; font-size: 0.92rem; }
  .players li.me { background: var(--pink-soft); }
  .online { width: 7px; height: 7px; border-radius: 50%; background: var(--track, #ccc); flex: none; opacity: 0.5; }
  .online.on { background: #22c55e; opacity: 1; }
  .name { font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .you { font-family: var(--mono); font-size: 0.6rem; text-transform: uppercase; background: var(--teal); color: #10233a; border-radius: 4px; padding: 0 0.3rem; margin-left: 0.35rem; vertical-align: 2px; }
  .stat { font-size: 0.82rem; white-space: nowrap; }
  .stat strong { font-family: var(--mono); }
  .win { color: var(--pink); font-weight: 700; }
  .muted { color: var(--muted); }
  .pos { width: 1.6rem; text-align: center; font-family: var(--mono); font-weight: 700; }
  .rules { margin: 0.5rem 0 0; font-size: 0.72rem; color: var(--muted); text-align: center; }
</style>
