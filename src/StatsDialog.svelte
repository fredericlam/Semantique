<script lang="ts">
  /** Stats panel: my own numbers (this device, since the start) and today's ranking of all players. */
  import { fetchBoard, pseudo, savePseudo, type Board, type Stats } from "./lib/game.ts";

  let { lang, level, stats, suggestedName }: {
    lang: string; level: string; stats: Stats | null; suggestedName: () => string;
  } = $props();

  let dialog: HTMLDialogElement;
  let tab = $state<"perso" | "jour">("perso");
  let board = $state<Board | null>(null);
  let boardError = $state("");
  let name = $state(pseudo());
  let draft = $state("");
  let editing = $state(false);
  let saving = $state(false);

  export function open() {
    name = pseudo();
    editing = false;
    dialog.showModal();
    load();
  }

  async function load() {
    boardError = "";
    try {
      board = await fetchBoard(lang, level);
    } catch {
      boardError = "Classement indisponible pour le moment.";
    }
  }

  function startEdit() {
    draft = name || suggestedName();
    editing = true;
  }

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    try {
      name = await savePseudo(lang, draft);
      editing = false;
      await load();
    } catch (err) {
      boardError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  const medal = (pos: number) => ["🥇", "🥈", "🥉"][pos - 1] ?? String(pos);
  const meOutside = $derived(board?.me && !board.rows.some((r) => r.me) ? board.me : null);
</script>

<dialog bind:this={dialog} class="stats-dialog" onclick={(e) => e.target === dialog && dialog.close()}>
  <span class="tape" aria-hidden="true"></span>
  <h2>stats & classement</h2>

  <div class="seg" role="tablist">
    <button role="tab" aria-selected={tab === "perso"} onclick={() => (tab = "perso")}>🙋 perso</button>
    <button role="tab" aria-selected={tab === "jour"} onclick={() => (tab = "jour")}>☀️ aujourd'hui</button>
  </div>

  {#if tab === "perso"}
    {#if stats}
      <div class="grid">
        <div><strong>{stats.won}</strong><span>mots trouvés</span></div>
        <div><strong>{stats.played}</strong><span>parties</span></div>
        <div><strong>{stats.played ? Math.round((stats.won / stats.played) * 100) : 0}<small>%</small></strong><span>réussite</span></div>
        <div><strong>{stats.today}</strong><span>sur 24 h</span></div>
        <div><strong>{stats.bestTries ?? "–"}</strong><span>record (essais)</span></div>
        <div><strong>{stats.avgTries ?? "–"}</strong><span>essais en moy.</span></div>
      </div>
    {/if}
    {#if board?.me}
      <p class="rank-line">Aujourd'hui tu es <strong>{medal(board.me.pos)}{board.me.pos > 3 ? "ᵉ" : ""}</strong> sur {board.players} joueur{board.players > 1 ? "s" : ""}.</p>
    {:else if board}
      <p class="rank-line muted">Trouve un mot aujourd'hui pour entrer dans le classement du jour.</p>
    {/if}
    <p class="note-small muted">Compté sur cet appareil, en solo et dans les rooms.</p>
  {:else}
    {#if boardError}
      <p class="muted">{boardError}</p>
    {:else if !board}
      <p class="muted">Chargement…</p>
    {:else if !board.rows.length}
      <p class="muted">Personne n'a encore trouvé de mot aujourd'hui. À toi de jouer !</p>
    {:else}
      <ol class="board">
        {#each board.rows as r (r.pos + r.name)}
          <li class:me={r.me}>
            <span class="pos">{medal(r.pos)}</span>
            <span class="who" class:anon={r.anonymous}>{r.name}{#if r.me}<span class="you">toi</span>{/if}</span>
            <span class="score"><strong>{r.words}</strong> mot{r.words > 1 ? "s" : ""}{#if r.avgTries !== null}<small> · {String(r.avgTries).replace(".", ",")} essais</small>{/if}</span>
          </li>
        {/each}
        {#if meOutside}
          <li class="me gap">
            <span class="pos">{meOutside.pos}</span>
            <span class="who">{meOutside.name}<span class="you">toi</span></span>
            <span class="score"><strong>{meOutside.words}</strong> mot{meOutside.words > 1 ? "s" : ""}</span>
          </li>
        {/if}
      </ol>
      <p class="note-small muted">Le plus de mots trouvés depuis minuit, puis le moins d'essais en moyenne.</p>
    {/if}
  {/if}

  <div class="pseudo">
    {#if editing}
      <form onsubmit={saveName}>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={draft} maxlength="20" placeholder="ton pseudo (vide : anonyme)" autofocus aria-label="Ton pseudo au classement" />
        <button class="ok" disabled={saving}>ok</button>
        <button type="button" class="cancel" onclick={() => (editing = false)} aria-label="Annuler">✕</button>
      </form>
    {:else}
      <button class="pseudo-btn" onclick={startEdit}>
        au classement : <strong>{name || "anonyme"}</strong> <span class="pen">✏️ {name ? "changer" : "choisir un pseudo"}</span>
      </button>
    {/if}
  </div>

  <form method="dialog"><button class="go wide">fermer</button></form>
</dialog>

<style>
  .stats-dialog { width: min(420px, calc(100vw - 32px)); }
  .seg { display: flex; gap: 3px; padding: 3px; background: var(--panel-2); border-radius: 8px; margin: 0.6rem 0 0.8rem; }
  .seg button { flex: 1; border: 0; background: none; border-radius: 8px; padding: 0.4rem; font-size: 0.85rem; font-weight: 700; color: var(--muted); }
  .seg button[aria-selected="true"] { background: var(--ink); color: var(--panel); }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; text-align: center; }
  .grid div { display: flex; flex-direction: column; gap: 0.1rem; background: var(--panel-2); border-radius: 12px; padding: 0.55rem 0.2rem; }
  .grid strong { font-family: var(--mono); font-size: 1.5rem; color: var(--pink); }
  .grid small { font-size: 0.9rem; }
  .grid span { font-size: 0.68rem; color: var(--muted); }
  .rank-line { margin: 0.8rem 0 0; text-align: center; font-size: 0.92rem; }

  .board { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 50vh; overflow-y: auto; }
  .board li { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.4rem; border-radius: 8px; font-size: 0.92rem; }
  .board li.me { background: var(--pink-soft); }
  .board li.gap { margin-top: 0.4rem; border-top: 2px dashed var(--line); border-radius: 0 0 8px 8px; }
  .pos { width: 1.7rem; text-align: center; font-family: var(--mono); font-weight: 700; flex: none; }
  .who { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who.anon { font-weight: 500; color: var(--muted); }
  .you { font-family: var(--mono); font-size: 0.6rem; text-transform: uppercase; background: var(--teal); color: #10233a; border-radius: 4px; padding: 0 0.3rem; margin-left: 0.35rem; vertical-align: 2px; }
  .score { font-size: 0.82rem; white-space: nowrap; }
  .score strong { font-family: var(--mono); }
  .score small { color: var(--muted); }

  .note-small { margin: 0.6rem 0 0; font-size: 0.72rem; text-align: center; }
  .muted { color: var(--muted); }

  .pseudo { margin-top: 0.9rem; display: flex; justify-content: center; }
  .pseudo-btn { background: var(--panel-2); border: 0; border-radius: 8px; padding: 0.3rem 0.8rem; font-size: 0.82rem; color: var(--ink); cursor: pointer; }
  .pseudo-btn:hover .pen { color: var(--pink); }
  .pen { font-size: 0.75rem; font-weight: 700; color: var(--muted); }
  .pseudo form { display: flex; gap: 0.35rem; width: 100%; margin: 0; }
  .pseudo input { flex: 1; min-width: 0; font: inherit; font-weight: 700; font-size: 0.9rem; padding: 0.25rem 0.55rem; border: 2px solid var(--pink); border-radius: 8px; background: var(--panel); color: var(--ink); }
  .pseudo .ok { background: var(--pink); color: white; border: 0; border-radius: 8px; padding: 0 0.7rem; font-weight: 700; }
  .pseudo .cancel { background: none; border: 0; color: var(--muted); font-weight: 700; }
</style>
