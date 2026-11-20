<script lang="ts">
  import { onMount } from "svelte";
  import { forgetRoom, listRooms, myRooms, roomState, type PublicRoom } from "./lib/room.ts";
  import Icon from "./Icon.svelte";
  import LevelTag from "./LevelTag.svelte";
  import { SHOW_LEVELS } from "./lib/game.ts";

  let { lang, current, onjoin, onenter, oncode, oncreate, onback, currentRoom, onresume }: {
    lang: string; current: number; onjoin: (code: string) => void; onenter: (code: string) => void;
    oncode: () => void; oncreate: () => void; onback: () => void;
    currentRoom: { code: string; name: string } | null; onresume: () => void;
  } = $props();

  // rooms created/joined on this device, refreshed from the server
  type Mine = ReturnType<typeof myRooms>[number] & { players?: number; gone?: boolean };
  let mine = $state<Mine[]>(myRooms());
  let copied = $state<string | null>(null);

  async function refreshMine() {
    mine = await Promise.all(myRooms().map(async (r) => {
      try {
        const s = await roomState(lang, r.code);
        return { ...r, roomName: s.name, level: s.level, players: s.players.length };
      } catch (e) {
        return { ...r, gone: (e as { code?: string }).code === "not_found" };
      }
    }));
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      copied = code;
      setTimeout(() => (copied = null), 1500);
    } catch {}
  }

  function forget(code: string) {
    forgetRoom(code);
    mine = mine.filter((r) => r.code !== code);
  }

  let rooms = $state<PublicRoom[] | null>(null);
  let error = $state("");

  async function load() {
    try {
      rooms = await listRooms(lang);
      error = "";
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(() => {
    load();
    refreshMine();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  });

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
  };
</script>

<section class="rooms-page">
  <button class="back" onclick={onback}><Icon name="arrow-left" /> retour au jeu</button>
  <h2>les rooms</h2>
  <p class="lead">Même mot de l'heure pour tout le monde, progression en direct, classement entre vous.</p>

  {#if currentRoom}
    <button class="current" onclick={onresume}>
      <span class="live">↩ dernière room</span>
      <span class="info"><span class="name">{currentRoom.name}</span><span class="meta">code <strong>{currentRoom.code}</strong></span></span>
      <span class="go-back">reprendre <Icon name="arrow-right" /></span>
    </button>
  {/if}

  <div class="ctas">
    <button class="go" onclick={oncreate}>✨ créer une room</button>
    <button class="pill" onclick={oncode}>🔑 j'ai un code</button>
  </div>

  {#if mine.length}
    <h3>🗝️ mes rooms</h3>
    <ul class="list">
      {#each mine as r (r.code)}
        <li class="room" class:gone={r.gone}>
          <div class="info">
            <span class="name">{r.roomName ?? `Room ${r.code}`} {#if SHOW_LEVELS && r.level}<span class="lvl"><LevelTag level={r.level} /></span>{/if}{#if currentRoom?.code === r.code}<span class="here">dernière</span>{/if}</span>
            <span class="meta">
              <button class="code" onclick={() => copy(r.code)} title="Copier le code">{copied === r.code ? "copié ✓" : r.code}</button>
              · toi : <strong>{r.name}</strong>
              {#if r.players} · {r.players} joueur{r.players > 1 ? "s" : ""}{/if}
              {#if r.gone} · <span class="warn">expirée</span>{/if}
            </span>
          </div>
          {#if r.gone}
            <button class="forget" onclick={() => forget(r.code)}>retirer</button>
          {:else}
            <button class="join" onclick={() => onenter(r.code)}>entrer</button>
            <button class="x" onclick={() => forget(r.code)} title="Retirer de mes rooms (tu pourras la rejoindre avec un nouveau nom)" aria-label="Retirer de mes rooms">✕</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h3>🌍 rooms publiques</h3>
  {#if error}
    <p class="muted">{error}</p>
  {:else if rooms === null}
    <p class="muted">chargement…</p>
  {:else if rooms.length === 0}
    <div class="empty">
      <p>Aucune room publique pour l'instant.</p>
      <p class="muted small">Crée la première : elle apparaîtra ici pour tout le monde.</p>
    </div>
  {:else}
    <ul class="list">
      {#each rooms as r (r.code)}
        <li class="room">
          <div class="info">
            <span class="name">{r.name} {#if SHOW_LEVELS}<span class="lvl"><LevelTag level={r.level} /></span>{/if}</span>
            <span class="meta">
              {#if r.online}<span class="on">● {r.online} en ligne</span> · {/if}
              {r.players} joueur{r.players > 1 ? "s" : ""}
              {#if r.round === current && r.found} · 🎯 {r.found} {r.found > 1 ? "ont" : "a"} trouvé{/if}
              · {ago(r.lastActive)}
            </span>
          </div>
          <button class="join" onclick={() => onjoin(r.code)}>rejoindre</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="muted small note">🔒 Les rooms privées n'apparaissent pas ici : on les rejoint uniquement avec leur code.</p>
</section>

<style>
  .rooms-page { padding-bottom: 1rem; }
  .back { background: none; border: 0; padding: 0.3rem 0; font-weight: 600; color: var(--muted); }
  h2 { font-family: var(--script); font-weight: 400; font-size: 2.4rem; color: var(--pink); margin: 0.2rem 0 0; text-shadow: 1px 1px 0 var(--ink), 3px 3px 0 var(--teal); rotate: -2deg; }
  h3 { font-size: 1rem; margin: 1.6rem 0 0.6rem; }
  .lead { margin: 0.5rem 0 1rem; line-height: 1.4; }
  .ctas { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .go {
    font-family: var(--mono); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.9rem;
    background: var(--pink); color: white; border: 2px solid var(--line); border-radius: 14px; padding: 0.7rem 1rem; box-shadow: var(--shadow);
  }
  .pill { background: var(--panel); border: 2px solid var(--line); border-radius: 14px; padding: 0.7rem 1rem; font-weight: 700; box-shadow: var(--shadow-sm); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .room {
    display: flex; align-items: center; gap: 0.7rem; background: var(--panel); border: 2px solid var(--line);
    border-radius: 12px; padding: 0.7rem 0.8rem; box-shadow: var(--shadow-sm);
  }
  .room:nth-child(odd) { rotate: -0.4deg; }
  .room:nth-child(even) { rotate: 0.4deg; }
  .info { flex: 1; min-width: 0; display: grid; gap: 0.15rem; }
  .name { font-weight: 800; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 0.8rem; color: var(--muted); }
  .lvl { display: inline-flex; font-size: 0.72rem; font-weight: 700; background: var(--panel-2); border-radius: 99px; padding: 0.05rem 0.45rem; vertical-align: 0.1em; }
  .on { color: #16a34a; font-weight: 700; }
  .current {
    display: flex; align-items: center; gap: 0.7rem; width: 100%; margin: 0 0 1rem; padding: 0.75rem 0.9rem; text-align: left;
    background: linear-gradient(100deg, var(--sun-a), var(--pink)); color: #2a1440; border: 2px solid var(--line);
    border-radius: 14px; box-shadow: var(--shadow); font: inherit;
  }
  .current .live { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; background: white; color: #16a34a; border-radius: 99px; padding: 0.15rem 0.5rem; white-space: nowrap; }
  .current .meta { color: #2a1440; opacity: 0.8; }
  .go-back { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 800; white-space: nowrap; }
  .here { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; background: #16a34a; color: white; border-radius: 99px; padding: 0.05rem 0.45rem; margin-left: 0.35rem; vertical-align: 0.15em; }
  .code { font-family: var(--mono); font-weight: 700; letter-spacing: 0.1em; background: var(--panel-2); border: 0; border-radius: 6px; padding: 0 0.35rem; color: var(--ink); font-size: 0.8rem; }
  .room.gone { opacity: 0.6; }
  .x { background: none; border: 0; color: var(--muted); font-weight: 700; padding: 0.2rem 0.3rem; margin-left: -0.3rem; }
  .warn { color: var(--pink); font-weight: 700; }
  .forget { background: var(--panel); border: 2px solid var(--line); border-radius: 99px; padding: 0.35rem 0.85rem; font-weight: 700; white-space: nowrap; }
  .join { background: var(--pink); color: white; border: 2px solid var(--line); border-radius: 99px; padding: 0.35rem 0.85rem; font-weight: 700; white-space: nowrap; }
  .empty { background: var(--panel); border: 2px dashed var(--line); border-radius: 12px; padding: 0.4rem 1rem; text-align: center; }
  .muted { color: var(--muted); }
  .small { font-size: 0.82rem; }
  .note { margin-top: 1.2rem; text-align: center; }
</style>
