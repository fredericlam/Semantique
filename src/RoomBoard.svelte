<script lang="ts">
  import { heat, level } from "./lib/heat.ts";
  import type { Snapshot } from "./lib/room.ts";
  import LevelTag from "./LevelTag.svelte";
  import { SHOW_LEVELS, isSpecialLevel } from "./lib/game.ts";

  let { snap, me, vocabSize, connected, onshare, ontogglevisibility, onrename, onmode, onkick, onrenameroom }: {
    snap: Snapshot; me: string; vocabSize: number; connected: boolean; onshare: () => void; ontogglevisibility: () => void;
    onmode: (mode: "defi" | "collab") => void;
    onkick: (name: string) => void;
    onrenameroom: (name: string) => Promise<string | null>; // creator only; resolves to an error message, or null
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

  // creator (or admin): rename the room by tapping its name
  let editingRoom = $state(false);
  let roomDraft = $state("");
  async function saveRoomName(e: SubmitEvent) {
    e.preventDefault();
    const name = roomDraft.trim();
    if (!name || name === snap.name) return (editingRoom = false);
    saving = true;
    renameError = (await onrenameroom(name)) ?? "";
    saving = false;
    if (!renameError) editingRoom = false;
  }

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
  <header>
    <div class="title">
      {#if editingRoom}
        <form class="rename room-rename" onsubmit={saveRoomName}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={roomDraft} maxlength="30" autofocus aria-label="Nom de la room" onkeydown={(e) => e.key === "Escape" && (editingRoom = false)} />
          <button type="submit" class="ok" disabled={saving}>ok</button>
        </form>
      {:else if canKick}
        <button class="room-name editable" onclick={() => { roomDraft = snap.name; renameError = ""; editingRoom = true; }} title="Renommer la room (tu l'as créée)">{snap.name} <span class="pen">✏️</span></button>
      {:else}
        <span class="room-name">{snap.name}</span>
      {/if}
      <span class="meta">
        {#if SHOW_LEVELS || isSpecialLevel(snap.level)}<span class="lvl"><LevelTag level={snap.level} /></span>{/if}
        <span class="dot" class:on={connected} title={connected ? "en direct" : "reconnexion…"}></span>
        <span class="code" title="Code de la room">{snap.code}</span>
        {#if isOwner}
          <button class="vis" onclick={ontogglevisibility} title={snap.visibility === "public" ? "Publique : visible dans la liste. Toucher pour la rendre privée" : "Privée : seulement avec le code. Toucher pour la rendre publique"}>{snap.visibility === "public" ? "🌍" : "🔒"}</button>
        {:else}
          <span title={snap.visibility === "public" ? "Room publique" : "Room privée"}>{snap.visibility === "public" ? "🌍" : "🔒"}</span>
        {/if}
        {#if snap.owner}<span class="owner">· par {snap.owner}</span>{/if}
        <button class="invite" onclick={onshare}>🔗 inviter</button>
      </span>
    </div>
  </header>

  <div class="modes" role="radiogroup" aria-label="Mode de jeu de la room">
    <button role="radio" aria-checked={snap.mode === "defi"} class="m-defi" class:on={snap.mode === "defi"} onclick={() => onmode("defi")}
      title="Défi : chacun cherche de son côté, les mots des autres restent cachés">🏆 défi</button>
    <button role="radio" aria-checked={snap.mode === "collab"} class="m-collab" class:on={snap.mode === "collab"} onclick={() => onmode("collab")}
      title="Collaboratif : tout le monde voit les mots de tous, le premier qui trouve fait gagner l'équipe">🤝 collab</button>
  </div>

  <details class="people">
  <summary>
    <span class="chips">
      {#each live as p (p.name)}
        {@const n = p.now}
        <span class="chip" class:me={p.name === me} class:won={n?.status === "won"} title={p.online ? "en ligne" : "hors ligne"}>
          <span class="online" class:on={p.online}></span>{p.name}
          {#if n?.status === "won"}🎯{:else if n?.status === "gaveup"}🏳️{:else if n && n.tries}{level(n.best ?? 99999).emoji}{/if}
        </span>
      {/each}
    </span>
    <span class="sum">🎯 {found}/{snap.players.length} <span class="chev" aria-hidden="true">▾</span></span>
  </summary>
  <div class="seg" role="tablist">
    <button role="tab" aria-selected={tab === "live"} onclick={() => (tab = "live")}>ce mot · {found}/{snap.players.length} 🎯</button>
    <button role="tab" aria-selected={tab === "points"} onclick={() => (tab = "points")} title="5 / 3 / 2 pts aux 3 premiers à trouver, 1 pt ensuite, +1 sans indice">classement</button>
  </div>

  {#snippet who(p: { name: string })}
    {#if p.name === me && editing}
      <form class="rename" onsubmit={saveName}>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={draft} maxlength="20" autofocus aria-label="Ton nom dans la room" onkeydown={(e) => e.key === "Escape" && (editing = false)} />
        <button type="submit" class="ok" disabled={saving}>ok</button>
      </form>
    {:else if p.name === me}
      <button class="name mine" onclick={startEdit} title="Changer mon nom dans cette room">{p.name} <span class="pen">✏️</span></button>
    {:else}
      <span class="name">{p.name}</span>
    {/if}
  {/snippet}

  {#snippet kick(p: { name: string })}
    {#if canKick && p.name !== me}
      {#if kicking === p.name}
        <button class="kick confirm" onclick={() => { onkick(p.name); kicking = null; }} onblur={() => (kicking = null)} title="Confirmer">retirer ?</button>
      {:else}
        <button class="kick" onclick={() => (kicking = p.name)} aria-label={`Retirer ${p.name} de la room`} title={`Retirer ${p.name} de la room`}>✕</button>
      {/if}
    {/if}
  {/snippet}

  {#if renameError}<p class="rename-error">{renameError}</p>{/if}
  {#if tab === "live"}
    <ul class="players">
      {#each live as p (p.name)}
        {@const n = p.now}
        <li class:me={p.name === me}>
          <span class="online" class:on={p.online} title={p.online ? "en ligne" : "hors ligne"}></span>
          {@render who(p)}
          {#if !n || (n.tries === 0 && n.hints === 0 && n.status === "playing")}
            <span class="stat muted">–</span>
          {:else if n.status === "won"}
            <span class="stat win">🎯 {ord(n.place ?? 1)} · {n.tries}</span>
          {:else if n.status === "gaveup"}
            <span class="stat muted">🏳️</span>
          {:else}
            <span class="stat">{level(n.best ?? 99999).emoji} <strong>{heat(n.best ?? 99999, vocabSize).toFixed(1).replace(".", ",")}°</strong> · {n.tries}</span>
          {/if}
          {@render kick(p)}
        </li>
      {/each}
    </ul>
  {:else}
    <ol class="players">
      {#each standings as p, i (p.name)}
        <li class:me={p.name === me}>
          <span class="pos">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
          {@render who(p)}
          <span class="stat"><strong>{p.points}</strong> pts · {p.wins} 🎯</span>
          {@render kick(p)}
        </li>
      {/each}
    </ol>
  {/if}
  </details>
</section>

<style>
  /* same block as the play panel below it: 12px radius, 12px padding, 12px rhythm */
  .board {
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin: 0 0 14px; padding: 12px;
    border: 2px solid var(--line); border-radius: 12px; box-shadow: var(--shadow);
    background: color-mix(in srgb, var(--panel) 78%, transparent);
  }
  .board > * { margin: 0; }
  header { display: flex; align-items: center; gap: 0.6rem; }
  .title { display: grid; gap: 0.15rem; min-width: 0; flex: 1; }
  .room-name { font-weight: 900; font-size: 1.6rem; line-height: 1.1; color: var(--pink); text-shadow: 1px 1px 0 var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.room-name { background: none; border: 0; padding: 0; font-family: inherit; text-align: left; cursor: pointer; max-width: 100%; }
  button.room-name .pen { font-size: 0.9rem; text-shadow: none; opacity: 0.6; }
  button.room-name:hover .pen { opacity: 1; }
  .room-rename input { font-size: 1.2rem; font-weight: 900; padding: 0.3rem 0.5rem; }
  .lvl { display: inline-flex; font-size: 0.75rem; font-weight: 700; background: var(--panel-2); border-radius: 8px; padding: 0.1rem 0.5rem; vertical-align: 0.2em; }
  .meta { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--muted); min-width: 0; }
  .code { font-size: 0.72rem; }
  .code { font-family: var(--mono); font-weight: 700; letter-spacing: 0.12em; color: var(--ink); }
  .owner { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.on { background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: blink 2s infinite; }
  @keyframes blink { 50% { opacity: 0.5; } }
  .vis { background: var(--panel-2); border: 0; border-radius: 5px; padding: 0.05rem 0.35rem; cursor: pointer; }
  .invite { flex: none; margin-left: auto; background: none; border: 0; color: var(--muted); font-weight: 700; font-size: 0.78rem; padding: 0; cursor: pointer; white-space: nowrap; text-decoration: underline; }
  .invite:hover { color: var(--pink); }

  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; background: var(--panel-2); border: 2px solid var(--line); border-radius: 8px; }
  .modes button { border: 0; border-radius: 5px; padding: 0.5rem; background: none; color: var(--muted); font-weight: 800; font-size: 0.92rem; cursor: pointer; }
  .modes button.on { color: white; box-shadow: var(--shadow-sm); }
  .m-defi.on { background: linear-gradient(100deg, #ff9f5a, #ff3d8b); }
  .m-collab.on { background: linear-gradient(100deg, #2dd4bf, #0e9f9a); }

  .seg { display: flex; gap: 3px; padding: 3px; background: var(--panel-2); border-radius: 8px; }
  .seg button { flex: 1; border: 0; background: none; border-radius: 5px; padding: 0.4rem; font-size: 0.82rem; font-weight: 700; color: var(--muted); }
  .seg button[aria-selected="true"] { background: var(--ink); color: var(--panel); }

  /* the players, folded into one line of chips; open for the live list and the standings */
  .people summary { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; list-style: none; }
  .people summary::-webkit-details-marker { display: none; }
  .people[open] summary { margin-bottom: 12px; }
  .people[open] .seg { margin-bottom: 8px; }
  .chips { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; font-weight: 700; background: var(--panel-2); border-radius: 5px; padding: 0.15rem 0.45rem; white-space: nowrap; }
  .chip.me { background: var(--pink-soft); }
  .chip.won { color: var(--pink); }
  .sum { flex: none; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }
  .chev { display: inline-block; color: var(--muted); transition: rotate 0.15s; }
  .people[open] .chev { rotate: 180deg; }
  .players { list-style: none; padding: 0; margin: 0; display: grid; gap: 2px; }
  .players li { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.45rem; border-radius: 8px; font-size: 0.92rem; min-height: 2.2rem; }
  .players li.me { background: var(--pink-soft); }
  .online { width: 7px; height: 7px; border-radius: 50%; background: var(--track, #ccc); flex: none; opacity: 0.5; }
  .online.on { background: #22c55e; opacity: 1; }
  .name { font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  button.name { background: none; border: 0; padding: 0; color: inherit; font: inherit; font-weight: 800; cursor: pointer; }
  .pen { font-size: 0.75rem; opacity: 0.6; }
  button.name:hover .pen { opacity: 1; }
  .stat { font-size: 0.82rem; white-space: nowrap; }
  .stat strong { font-family: var(--mono); }
  .win { color: var(--pink); font-weight: 700; }
  .muted { color: var(--muted); }
  .pos { width: 1.6rem; text-align: center; font-family: var(--mono); font-weight: 700; flex: none; }
  .kick { flex: none; background: none; border: 0; color: var(--muted); font-weight: 700; font-size: 0.8rem; padding: 0 0.25rem; cursor: pointer; }
  .kick:hover { color: var(--pink); }
  .kick.confirm { background: var(--pink); color: white; border-radius: 5px; padding: 0.1rem 0.5rem; font-size: 0.72rem; }
  .rename { flex: 1; display: flex; gap: 0.35rem; min-width: 0; }
  .rename input { flex: 1; min-width: 0; font: inherit; font-weight: 700; font-size: 0.9rem; padding: 0.15rem 0.45rem; border: 2px solid var(--pink); border-radius: 5px; background: var(--panel); color: var(--ink); }
  .rename .ok { background: var(--pink); color: white; border: 0; border-radius: 5px; padding: 0 0.6rem; font-weight: 700; font-size: 0.8rem; }
  .rename-error { font-size: 0.78rem; color: var(--pink); font-weight: 600; }
</style>
