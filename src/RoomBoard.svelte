<script lang="ts">
  import { heat, level } from "./lib/heat.ts";
  import type { Snapshot } from "./lib/room.ts";
  import LevelTag from "./LevelTag.svelte";
  import { SHOW_LEVELS } from "./lib/game.ts";

  let { snap, me, vocabSize, connected, onshare, ontogglevisibility, onrename, onmode, onkick }: {
    snap: Snapshot; me: string; vocabSize: number; connected: boolean; onshare: () => void; ontogglevisibility: () => void;
    onmode: (mode: "defi" | "collab") => void;
    onkick: (name: string) => void;
    onrename: (name: string) => Promise<string | null>; // resolves to an error message, or null when done
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let renameError = $state("");
  let saving = $state(false);

  function startEdit() {
    draft = me;
    renameError = "";
    editing = true;
  }

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || name === me) return (editing = false);
    saving = true;
    renameError = (await onrename(name)) ?? "";
    saving = false;
    if (!renameError) editing = false;
  }
  const isOwner = $derived(snap.owner === me);
  const canKick = $derived(isOwner || (snap.admins ?? []).includes(me)); // creator or admin
  let kicking = $state<string | null>(null); // player awaiting a second tap to be removed

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
      <span class="name-line">
        <span class="room-name">{snap.name} {#if SHOW_LEVELS}<span class="lvl"><LevelTag level={snap.level} /></span>{/if}</span>
        {#if snap.owner}<span class="owner" title="Créateur ou créatrice de la room">par <strong>{snap.owner}</strong></span>{/if}
      </span>
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
        </span>
      </span>
    </div>
  </header>

  <div class="me-line">
    {#if editing}
      <form class="rename" onsubmit={saveName}>
        <span class="me-label">ton nom</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={draft} maxlength="20" autofocus aria-label="Ton nom dans la room" onkeydown={(e) => e.key === "Escape" && (editing = false)} />
        <button type="submit" class="ok" disabled={saving}>ok</button>
        <button type="button" class="cancel" onclick={() => (editing = false)} aria-label="Annuler">✕</button>
      </form>
    {:else}
      <button class="me-btn" onclick={startEdit} title="Changer mon nom dans cette room">
        <span class="me-label">toi</span> <strong>{me}</strong> <span class="pen">✏️ renommer</span>
      </button>
    {/if}
  </div>

  <div class="modes" role="radiogroup" aria-label="Mode de jeu de la room">
    <button role="radio" aria-checked={snap.mode === "defi"} class="m-defi" class:on={snap.mode === "defi"} onclick={() => onmode("defi")}>
      🏆 défi <small>chacun pour soi</small>
    </button>
    <button role="radio" aria-checked={snap.mode === "collab"} class="m-collab" class:on={snap.mode === "collab"} onclick={() => onmode("collab")}>
      🤝 collaboratif <small>mots partagés</small>
    </button>
  </div>
  <p class="same">
    {#if snap.mode === "collab"}🤝 une partie commune : tout le monde voit les mots de tous, le premier qui trouve fait gagner l'équipe.
    {:else}🏆 chacun cherche de son côté, les mots des autres restent cachés.{/if}
    Même mot que tout le monde, nouveau toutes les 3 heures.
  </p>
  <div class="seg" role="tablist">
    <button role="tab" aria-selected={tab === "live"} onclick={() => (tab = "live")}>ce mot · {found}/{snap.players.length} 🎯</button>
    <button role="tab" aria-selected={tab === "points"} onclick={() => (tab = "points")}>classement</button>
  </div>

  {#if renameError}<p class="rename-error">{renameError}</p>{/if}
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
          {#if canKick && p.name !== me}
            {#if kicking === p.name}
              <button class="kick confirm" onclick={() => { onkick(p.name); kicking = null; }} onblur={() => (kicking = null)} title="Confirmer">retirer ?</button>
            {:else}
              <button class="kick" onclick={() => (kicking = p.name)} aria-label={`Retirer ${p.name} de la room`} title={`Retirer ${p.name} de la room`}>✕</button>
            {/if}
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
          {#if canKick && p.name !== me}
            {#if kicking === p.name}
              <button class="kick confirm" onclick={() => { onkick(p.name); kicking = null; }} onblur={() => (kicking = null)} title="Confirmer">retirer ?</button>
            {:else}
              <button class="kick" onclick={() => (kicking = p.name)} aria-label={`Retirer ${p.name} de la room`} title={`Retirer ${p.name} de la room`}>✕</button>
            {/if}
          {/if}
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
  .name-line { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .owner { flex: none; font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
  .owner strong { color: var(--ink); }
  .kick { flex: none; background: none; border: 0; color: var(--muted); font-weight: 700; font-size: 0.8rem; padding: 0 0.25rem; cursor: pointer; }
  .kick:hover { color: var(--pink); }
  .kick.confirm { background: var(--pink); color: white; border-radius: 99px; padding: 0.05rem 0.5rem; font-size: 0.72rem; }
  .room-name { min-width: 0; font-family: var(--script); font-size: 1.7rem; line-height: 1.05; color: var(--pink); text-shadow: 1px 1px 0 var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lvl { display: inline-flex; font-family: var(--font); font-size: 0.75rem; font-weight: 700; color: var(--ink); background: var(--panel-2); border-radius: 99px; padding: 0.1rem 0.5rem; vertical-align: 0.35em; text-shadow: none; }
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
  .me-line { margin: 0 0 0.4rem; }
  .same { margin: 0 0 0.5rem; font-size: 0.72rem; color: var(--muted); }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 0.45rem; }
  .modes button {
    display: grid; gap: 0.05rem; border: 2px solid var(--line); border-radius: 12px; padding: 0.4rem 0.5rem;
    background: var(--panel); color: var(--ink); font-weight: 800; font-size: 0.88rem; text-align: center; opacity: 0.6;
  }
  .modes button small { font-weight: 500; font-size: 0.68rem; color: var(--muted); }
  .modes button.on { opacity: 1; color: white; box-shadow: var(--shadow-sm); }
  .modes button.on small { color: rgb(255 255 255 / 0.85); }
  .m-defi.on { background: linear-gradient(100deg, #ff9f5a, #ff3d8b); }
  .m-collab.on { background: linear-gradient(100deg, #2dd4bf, #0e9f9a); }
  .me-btn { display: inline-flex; align-items: center; gap: 0.35rem; background: var(--panel-2); border: 0; border-radius: 99px; padding: 0.25rem 0.7rem; font-size: 0.85rem; color: var(--ink); cursor: pointer; }
  .me-btn:hover .pen { color: var(--pink); }
  .me-label { font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  .pen { font-size: 0.75rem; font-weight: 700; color: var(--muted); }
  .rename { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
  .rename input { flex: 1; min-width: 0; font: inherit; font-weight: 700; font-size: 0.9rem; padding: 0.15rem 0.45rem; border: 2px solid var(--pink); border-radius: 8px; background: var(--panel); color: var(--ink); }
  .rename .ok { background: var(--pink); color: white; border: 0; border-radius: 8px; padding: 0 0.55rem; font-weight: 700; font-size: 0.8rem; }
  .rename .cancel { background: none; border: 0; color: var(--muted); font-weight: 700; }
  .rename-error { margin: 0.3rem 0 0; font-size: 0.78rem; color: var(--pink); font-weight: 600; }
  .rules { margin: 0.5rem 0 0; font-size: 0.72rem; color: var(--muted); text-align: center; }
</style>
