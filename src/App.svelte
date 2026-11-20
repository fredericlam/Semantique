<script lang="ts">
  import { onMount, tick } from "svelte";
  import { isStandalone } from "./lib/pwa.ts";
  import GuessRow from "./GuessRow.svelte";
  import RoomBoard from "./RoomBoard.svelte";
  import RoomsPage from "./RoomsPage.svelte";
  import BugDialog from "./BugDialog.svelte";
  import Icon from "./Icon.svelte";
  import LevelTag from "./LevelTag.svelte";
  import HistoryList from "./HistoryList.svelte";
  import {
    cleanCode, connect, createRoom, joinRoom, lastName, lastRoom, roomGiveUp, roomGuess, roomHint, roomMine, roomResume,
    roomReveal, roomSetVisibility, roomState, savedSession, saveSession, rememberRoom, myRooms, type RoomGuess, type Session, type Snapshot, type Visibility,
  } from "./lib/room.ts";
  import { clean, loadLexicon, resolve, type Lexicon } from "./lib/lexicon.ts";
  import { LEVELS, level, temperature } from "./lib/heat.ts";
  import {
    buildTracks, computeStats, fetchGuess, fetchHistory, SHOW_LEVELS, fetchHint, fetchMeta, fetchTop, loadState, nextHintRank, saveState, LEVEL_INFO, levelLabel,
    type GameState, type Guess, type Meta,
  } from "./lib/game.ts";

  const LANG = "fr";
  const TZ = "Europe/Paris";

  let meta = $state<Meta | null>(null);
  let lex = $state<Lexicon | null>(null);
  let round = $state(0);
  let game = $state<GameState>({ guesses: [], status: "playing" });
  let input = $state("");
  let busy = $state(false);
  let loadError = $state("");
  let feedback = $state<
    | { kind: "unknown"; input: string; suggestions: string[] }
    | { kind: "dup"; word: string }
    | { kind: "alts"; word: string; alts: string[] }
    | { kind: "error"; message: string }
    | null
  >(null);
  let last = $state<Guess | null>(null);
  let flashId = $state<number | null>(null);
  let view = $state<"rank" | "tracks" | "time">("rank");
  let confirmGiveUp = $state(false);
  let top = $state<Omit<Guess, "input" | "n">[]>([]);
  let copied = $state(false);
  let now = $state(Date.now());
  let inputEl = $state<HTMLInputElement>();
  let helpDialog: HTMLDialogElement;
  let statsDialog: HTMLDialogElement;

  // rooms
  let session = $state<Session | null>(null);
  let snap = $state<Snapshot | null>(null);
  let connected = $state(false);
  let roomWords = $state<{ name: string; guesses: RoomGuess[] }[]>([]);
  let toasts = $state<{ id: number; text: string }[]>([]);
  let roomDialog: HTMLDialogElement;
  let joinCode = $state("");
  let joinName = $state("");
  let roomName = $state("");
  let roomVisibility = $state<Visibility>("public");
  let soloLevel = $state<string>(SHOW_LEVELS ? (() => { try { return localStorage.getItem("semantique:level") ?? "adult"; } catch { return "adult"; } })() : "adult");
  let createLevel = $state("adult");
  /** In a room, its level; otherwise the one picked on this device. */
  const playLevel = $derived(session && snap ? snap.level : soloLevel);
  let dialogMode = $state<"join" | "create">("join");
  /** game = solo (home), rooms = rooms hub, room = inside one room (its own game). */
  type Page = "game" | "rooms" | "room";
  const pageFromPath = (): Page =>
    location.pathname.startsWith("/rooms") ? "rooms" : /^\/room\/[A-Za-z0-9]{5}\/?$/.test(location.pathname) ? "room" : "game";
  let page = $state<Page>(pageFromPath());
  let joinError = $state("");
  let joinBusy = $state(false);
  let disconnect: (() => void) | null = null;
  let pastWords = $state<{ round: number; word: string }[]>([]);
  let bugDialog = $state<{ open: () => void }>();

  /** Technical context for bug reports — never the room code nor the guessed words. */
  const bugContext = () => ({
    version: meta?.version ?? null,
    page: page === "rooms" ? "/rooms" : session ? "/room/(masqué)" : "/",
    mode: session ? "room" : "solo",
    manche: round || null,
    statut: game.status,
    essais: game.guesses.length,
    app_installée: isStandalone(),
    écran: `${innerWidth}×${innerHeight}`,
    navigateur: navigator.userAgent,
    date: new Date().toISOString(),
  });

  const tries = $derived(game.guesses.filter((g) => !g.hint).length);
  const hints = $derived(game.guesses.filter((g) => g.hint).length);
  const best = $derived(game.guesses.reduce<Guess | null>((b, g) => (!b || g.rank < b.rank ? g : b), null));
  const byRank = $derived([...game.guesses].sort((a, b) => a.rank - b.rank));
  const byTime = $derived([...game.guesses].sort((a, b) => b.n - a.n));
  const tracks = $derived(lex && view === "tracks" ? buildTracks(lex, game.guesses) : []);
  const over = $derived(game.status !== "playing");
  const noMoreHints = $derived(nextHintRank(game.guesses, playLevel) === null);
  const guessed = $derived(new Set(game.guesses.map((g) => g.id)));
  const stats = $derived(meta ? (game.status, computeStats(LANG, soloLevel, meta.current)) : null);
  const remaining = $derived(meta ? Math.max(0, Date.parse(meta.nextAt) - now) : 0);
  const newWordReady = $derived(!!meta && remaining === 0);
  const countdown = $derived(`${String(Math.floor(remaining / 60000)).padStart(2, "0")}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")}`);

  /** "10h" (today), "hier 22h", "18/11 9h": the hour at which a round started. */
  function roundLabel(n: number): string {
    if (!meta) return "";
    const t = Date.parse(meta.start) + (n - 1) * meta.period * 1000;
    const hour = new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).formatToParts(t).find((p) => p.type === "hour")!.value;
    const day = (x: number) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ }).format(x);
    const today = day(Date.now()), yesterday = day(Date.now() - 86_400_000), that = day(t);
    const prefix = that === today ? "" : that === yesterday ? "hier " : `${that.slice(8, 10)}/${that.slice(5, 7)} `;
    return `${prefix}${Number(hour)}h`;
  }

  async function loadHistory() {
    pastWords = await fetchHistory(LANG, playLevel);
  }

  async function openRound(n: number) {
    round = n;
    roomWords = [];
    if (session) {
      // in a room the server is the source of truth (and lets you switch devices)
      const mine = await roomMine(LANG, session, n);
      game = { guesses: mine.guesses.map((g) => ({ ...g, input: "" })), status: mine.status };
    } else {
      game = loadState(LANG, soloLevel, n);
    }
    // drop duplicates left by older versions
    game.guesses = game.guesses.filter((g, i, all) => all.findIndex((o) => o.word === g.word) === i);
    last = game.guesses.find((g) => g.n === game.guesses.length) ?? null;
    feedback = null;
    top = [];
    if (lex) for (const g of game.guesses) g.id = lex.index.get(g.word) ?? g.id; // ids depend on the vocab build
    await loadTop();
    loadHistory();
  }

  async function goToLatest() {
    meta = await fetchMeta(LANG);
    await openRound(meta.current);
    await tick();
    inputEl?.focus();
  }

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    (async () => {
      try {
        meta = await fetchMeta(LANG);
        lex = await loadLexicon(LANG, meta.vecDims, meta.version);
        // the solo game always loads (home); a /room/CODE link opens that room on top of it
        const asked = Number(new URLSearchParams(location.search).get("manche"));
        await openRound(asked >= 1 && asked <= meta.current ? asked : meta.current);
        const fromPath = location.pathname.match(/^\/room\/([A-Za-z0-9]{5})\/?$/)?.[1]?.toUpperCase();
        if (fromPath) await enterSaved(fromPath);
        if (!localStorage.getItem("semantique:seen-help")) {
          helpDialog.showModal();
          localStorage.setItem("semantique:seen-help", "1");
        }
      } catch (e) {
        loadError = String((e as Error).message ?? e);
      }
    })();
    return () => {
      clearInterval(timer);
      disconnect?.();
    };
  });

  // ---------------------------------------------------------------- rooms

  function toast(text: string) {
    const id = Math.random();
    toasts.push({ id, text });
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 4500);
  }

  function openRoomDialog(code = "", mode: "join" | "create" = "join") {
    dialogMode = mode;
    createLevel = SHOW_LEVELS ? soloLevel : "adult";
    joinCode = code;
    joinName = joinName || lastName();
    joinError = "";
    roomDialog.showModal();
  }

  async function enterRoom(s: Session) {
    disconnect?.();
    session = s;
    saveSession(s);
    page = "room";
    if (location.pathname !== `/room/${s.code}`) history.pushState(null, "", `/room/${s.code}`);
    scrollTo({ top: 0 });
    snap = await roomState(LANG, s.code);
    rememberRoom(s.code, { roomName: snap.name, level: snap.level });
    disconnect = connect(LANG, s, {
      snapshot: (x) => {
        snap = x;
        rememberRoom(x.code, { roomName: x.name, level: x.level });
      },
      event: toast,
      status: (v) => (connected = v),
    });
    meta = await fetchMeta(LANG);
    await openRound(meta.current);
  }

  async function submitJoin(create: boolean) {
    joinError = "";
    const name = joinName.trim();
    if (!name) return (joinError = "Choisis ton nom de joueur.");
    joinBusy = true;
    try {
      const code = create ? (await createRoom(LANG, roomName, roomVisibility, createLevel)).code : cleanCode(joinCode);
      if (code.length !== 5) throw new Error("Le code fait 5 caractères.");
      const res = await joinRoom(LANG, code, name, savedSession(code)?.token);
      roomDialog.close();
      await enterRoom({ code, name: res.name, token: res.token });
      toast(create ? `« ${snap?.name} » créée (code ${code}) : invite tes potes !` : `Bienvenue dans « ${snap?.name} » 👋`);
    } catch (e) {
      joinError = (e as Error).message;
    } finally {
      joinBusy = false;
    }
  }

  // ---------------------------------------------------------------- theme (footer switch)
  type Theme = "auto" | "light" | "dark";
  let theme = $state<Theme>((() => { try { return (localStorage.getItem("semantique:theme") as Theme) ?? "auto"; } catch { return "auto"; } })());

  function setTheme(t: Theme) {
    theme = t;
    try {
      if (t === "auto") localStorage.removeItem("semantique:theme");
      else localStorage.setItem("semantique:theme", t);
    } catch {}
    const root = document.documentElement;
    if (t === "auto") delete root.dataset.theme;
    else root.dataset.theme = t;
    const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const m = Object.assign(document.createElement("meta"), { name: "theme-color", content: dark ? "#1b0f2e" : "#ffd9c2" });
    document.head.appendChild(m);
  }

  /** "Vecteurs : Jean-Philippe Fauconnier, frWac (CC-BY) — https://…" → label, linked text, licence. */
  function parseCredit(c: string) {
    const m = c.match(/^(.*?)\s*:\s*(.*?)\s*—\s*(https?:\/\/\S+)$/);
    if (!m) return { label: "", text: c, licence: "", url: "" };
    const lic = m[2].match(/\s*\(([^)]+)\)\s*$/);
    return { label: m[1], text: lic ? m[2].slice(0, lic.index) : m[2], licence: lic?.[1] ?? "", url: m[3] };
  }

  async function setLevel(l: string) {
    if (l === soloLevel) return;
    soloLevel = l;
    try { localStorage.setItem("semantique:level", l); } catch {}
    if (!session && meta) await openRound(meta.current);
  }

  /** Leave the room screen (the room membership stays in "mes rooms"). */
  function closeRoom() {
    disconnect?.();
    disconnect = null;
    session = null;
    snap = null;
    roomWords = [];
  }

  async function goPage(p: "game" | "rooms", push = true) {
    const wasRoom = !!session;
    if (wasRoom) closeRoom();
    page = p;
    const path = p === "rooms" ? "/rooms" : "/";
    if (push && location.pathname !== path) history.pushState(null, "", path);
    scrollTo({ top: 0 });
    if (p === "game" && meta && wasRoom) await openRound(meta.current); // back to the solo game
  }

  onMount(() => {
    const onPop = () => {
      const p = pageFromPath();
      if (p === "room") enterSaved(location.pathname.slice(6, 11).toUpperCase());
      else goPage(p, false);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  /** The room I opened last (for the "reprendre" card of the hub). */
  function lastOpened() {
    const code = lastRoom();
    const r = code ? myRooms().find((x) => x.code === code) : null;
    return r ? { code: r.code, name: r.roomName ?? `Room ${r.code}` } : null;
  }

  /** Back into a room I already joined on this device (no code, no name to type). */
  async function enterSaved(code: string) {
    const s = savedSession(code);
    if (!s) {
      // not a member yet: show the hub with the join dialog pre-filled
      await goPage("rooms", false);
      history.replaceState(null, "", "/rooms");
      return openRoomDialog(code, "join");
    }
    try {
      const ok = await joinRoom(LANG, code, s.name, s.token);
      await enterRoom({ ...s, name: ok.name });
    } catch (e) {
      toast((e as Error).message);
      await goPage("rooms");
    }
  }

  async function toggleVisibility() {
    if (!session || !snap) return;
    try {
      await roomSetVisibility(LANG, session, snap.visibility === "public" ? "private" : "public");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  /** Back into the round after giving up — the word was not revealed yet. */
  async function resume() {
    if (session) {
      try {
        await roomResume(LANG, session);
      } catch (e) {
        return toast((e as Error).message);
      }
    }
    game.status = "playing";
    top = [];
    persist();
    await tick();
    inputEl?.focus();
  }

  async function leaveRoom() {
    await goPage("rooms");
  }

  async function inviteRoom() {
    if (!session) return;
    const url = `${location.origin}/room/${session.code}`;
    const text = `Viens jouer à Sémantique dans la room « ${snap?.name ?? session.code} » (code ${session.code}) 🌴`;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast("Lien d'invitation copié 🔗");
      }
    } catch {}
  }

  function persist() {
    if (session) return; // the room keeps the state
    saveState(LANG, soloLevel, round, $state.snapshot(game) as GameState);
  }

  function add(g: Omit<Guess, "input" | "n">, typed: string, hint = false) {
    if (game.guesses.some((o) => o.id === g.id)) return;
    const guess: Guess = { ...g, input: typed && typed !== g.word ? typed : "", n: game.guesses.length + 1, ...(hint ? { hint } : {}) };
    if ("n" in g && typeof g.n === "number") guess.n = g.n;
    game.guesses.push(guess);
    last = guess;
    if (guess.rank === 0) finish("won");
    persist();
  }

  async function finish(status: "won" | "gaveup") {
    game.status = status;
    persist();
    await loadTop();
  }

  /** The answer: right away if found, otherwise once the hour is over. */
  async function loadTop() {
    if (game.status === "playing" || !meta) return;
    const found = game.guesses.find((g) => g.rank === 0)?.word;
    if (!found && round >= meta.current) return;
    if (session) {
      try {
        const r = await roomReveal(LANG, session, round);
        top = r.top;
        roomWords = r.players.filter((p) => p.name !== session!.name);
      } catch {}
    } else top = await fetchTop(LANG, soloLevel, round, found);
  }

  // when the hour flips, a given-up round can finally show its word
  $effect(() => {
    if (newWordReady && game.status === "gaveup" && !top.length && meta) {
      fetchMeta(LANG).then(async (m) => { meta = m; await loadTop(); });
    }
  });

  async function submit(raw = input) {
    if (!lex || busy || over || !raw.trim()) return;
    feedback = null;
    const res = resolve(lex, raw);
    if (res.kind === "unknown") {
      feedback = { kind: "unknown", input: clean(raw), suggestions: res.suggestions };
      return;
    }
    const existing = game.guesses.find((g) => g.id === res.id);
    if (existing) {
      feedback = { kind: "dup", word: existing.word };
      input = "";
      flash(existing.id);
      return;
    }
    busy = true;
    try {
      add(session ? await roomGuess(LANG, session, res.word) : await fetchGuess(LANG, soloLevel, round, res.word), clean(raw));
      if (res.alts.length) feedback = { kind: "alts", word: res.word, alts: res.alts.filter((a) => !game.guesses.some((g) => g.word === a)) };
      input = "";
    } catch (e) {
      feedback = { kind: "error", message: (e as Error).message || "Le serveur ne répond pas, réessaie." };
      if (session && (e as { code?: string }).code === "finished") await openRound(round);
    } finally {
      busy = false;
      await tick();
      inputEl?.focus();
    }
  }

  async function flash(id: number) {
    flashId = null;
    await tick();
    flashId = id;
    setTimeout(() => (flashId = null), 1300);
  }

  async function hint() {
    const target = nextHintRank(game.guesses, playLevel);
    if (busy || over || target === null) return;
    busy = true;
    try {
      add(session ? await roomHint(LANG, session) : await fetchHint(LANG, soloLevel, round, target), "", true);
    } catch (e) {
      feedback = { kind: "error", message: (e as Error).message };
    } finally {
      busy = false;
    }
  }

  async function giveUp() {
    if (!confirmGiveUp) {
      confirmGiveUp = true;
      setTimeout(() => (confirmGiveUp = false), 4000);
      return;
    }
    confirmGiveUp = false;
    if (session) {
      try {
        await roomGiveUp(LANG, session);
      } catch (e) {
        feedback = { kind: "error", message: (e as Error).message };
        return;
      }
    }
    await finish("gaveup");
  }

  function shareText() {
    const counts = LEVELS.slice(1).map((l) => [l, game.guesses.filter((g) => !g.hint && level(g.rank) === l).length] as const);
    const label = `Sémantique 🌴 mot de ${roundLabel(round)}${SHOW_LEVELS ? ` · ${levelLabel(playLevel)}` : ""}${session ? ` · room ${snap?.name ?? session.code}` : ""}`;
    const head = game.status === "won"
      ? `${label} — 🎯 en ${tries} essai${tries > 1 ? "s" : ""}${hints ? ` (${hints} 💡)` : ""}`
      : `${label} — 🏳️ abandon, meilleur ${best && meta ? temperature(best.rank, meta.vocabSize).toFixed(1) : "0"}°`;
    const line = counts.filter(([, n]) => n).map(([l, n]) => `${l.emoji}${n}`).join(" ");
    return `${head}\n${line}\n${location.origin}${location.pathname}`;
  }

  async function share() {
    const text = shareText();
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        copied = true;
        setTimeout(() => (copied = false), 2000);
      }
    } catch {}
  }
</script>


<div class="page">
  <header>
    <div class="sun" aria-hidden="true"></div>
    <svg class="palm" viewBox="0 0 64 96" aria-hidden="true"><path d="M33 94c-2-22 0-44 4-60" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M37 34c-10-12-24-12-34-4 12-2 22 0 34 4zM37 34c4-14 16-22 26-20-12 4-20 10-26 20zM37 34c-14 0-24 8-28 18 8-8 18-12 28-18zM37 34c12-4 22 2 26 10-8-6-16-8-26-10zM37 34c-2-12-10-22-20-26 10 8 16 16 20 26z" fill="currentColor"/></svg>
    <div class="brand">
      <h1><a href="/" class="home" onclick={(e) => { e.preventDefault(); goPage("game"); }} title="Accueil">Sémantique</a></h1>
      {#if meta}<span class="day">mot de {roundLabel(round)} <span class="sep">·</span> <span class="timer" title="Prochain mot dans">⏱ {countdown}</span></span>{/if}
    </div>
    <div class="header-actions">
      {#if !isStandalone()}<a class="icon install" href="/installer/" aria-label="Installer l'app" title="Installer l'app">📲</a>{/if}
      <button class="icon" class:active={!!session} onclick={() => goPage("rooms")} aria-label="Rooms" title="Les rooms"><Icon name="users" size="1.45rem" /></button>
      <button class="icon" onclick={() => statsDialog.showModal()} aria-label="Statistiques">📊</button>
      <button class="icon" onclick={() => helpDialog.showModal()} aria-label="Comment jouer">?</button>
    </div>
  </header>

  {#if loadError}
    <p class="note error-box">Impossible de charger le jeu : {loadError}</p>
  {:else if !meta}
    <p class="loading">Chargement…</p>
  {:else if page === "rooms"}
    <RoomsPage
      lang={LANG}
      current={meta.current}
      onjoin={(code) => (savedSession(code) ? enterSaved(code) : openRoomDialog(code, "join"))}
      onenter={enterSaved}
      currentRoom={lastOpened()}
      onresume={() => { const c = lastRoom(); if (c) enterSaved(c); }}
      oncode={() => openRoomDialog("", "join")}
      oncreate={() => openRoomDialog("", "create")}
      onback={() => goPage("game")}
    />
  {:else if page === "room" && !(session && snap)}
    <p class="loading">Ouverture de la room…</p>
  {:else}
    {#if session && snap}
      <button class="room-back" onclick={leaveRoom}><Icon name="arrow-left" /> mes rooms</button>
      <RoomBoard {snap} me={session.name} vocabSize={meta.vocabSize} {connected} onshare={inviteRoom} ontogglevisibility={toggleVisibility} />
    {:else}
      {#if SHOW_LEVELS}
      <div class="levels" role="radiogroup" aria-label="Niveau de difficulté">
        {#each meta.levels as l (l)}
          <button role="radio" aria-checked={soloLevel === l} class:on={soloLevel === l} onclick={() => setLevel(l)} title={LEVEL_INFO[l]?.hint}>
            <LevelTag level={l} size="1.25em" />
          </button>
        {/each}
      </div>
      {/if}
      <button class="room-cta" onclick={() => goPage("rooms")}>
        <span class="cta-emoji"><Icon name="users" size="1.9rem" /></span>
        <span class="cta-text"><strong>Rejoins une room</strong><small>joue à plusieurs sur le mot de l'heure</small></span>
        <span class="install-arrow"><Icon name="arrow-right" /></span>
      </button>
    {/if}

    {#if newWordReady || round !== meta.current}
      <button class="banner" onclick={goToLatest}>
        🌴 {newWordReady ? "Nouveau mot dispo !" : "Le mot de l'heure t'attend"} <strong>jouer <Icon name="arrow-right" /></strong>
      </button>
    {/if}

    <section class="console">
      {#if !over}
        <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            bind:this={inputEl}
            bind:value={input}
            placeholder={lex ? "tape un mot…" : "chargement du dico…"}
            disabled={!lex}
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send"
            aria-label="Ton essai"
          />
          <button type="submit" class="go" disabled={busy || !input.trim()} aria-label="Essayer">GO</button>
        </form>

        <div class="feedback" aria-live="polite">
          {#if feedback?.kind === "unknown"}
            <span class="err">« {feedback.input} » n'est pas dans le dico.</span>
            {#if feedback.suggestions.length}
              Peut-être
              {#each feedback.suggestions as s}<button class="chip" onclick={() => submit(s)}>{s}</button>{/each}
            {/if}
          {:else if feedback?.kind === "dup"}
            Déjà essayé : <strong>{feedback.word}</strong> ↓
          {:else if feedback?.kind === "alts" && feedback.alts.length}
            Compris <strong>{feedback.word}</strong>. Ou bien
            {#each feedback.alts as a}<button class="chip" onclick={() => submit(a)}>{a}</button>{/each} ?
          {:else if feedback?.kind === "error"}
            <span class="err">{feedback.message}</span>
          {/if}
        </div>
      {/if}

      {#if last && !over}
        <ul class="last" aria-label="Dernier essai"><GuessRow g={last} vocabSize={meta.vocabSize} big /></ul>
      {/if}

      {#if over}
        <div class="end polaroid" class:won={game.status === "won"}>
          <span class="tape" aria-hidden="true"></span>
          {#if game.status === "won"}
            <p class="kicker">🎯 trouvé !</p>
            <p class="secret">{top[0]?.word ?? best?.word}</p>
            <p>en <strong>{tries}</strong> essai{tries > 1 ? "s" : ""}{hints ? ` · ${hints} indice${hints > 1 ? "s" : ""}` : ""}</p>
          {:else}
            {#if top.length}
              <p class="kicker">le mot était</p>
              <p class="secret">{top[0].word}</p>
            {:else}
              <p class="kicker">🏳️ abandon</p>
              <p class="secret">{roundLabel(round + 1)}</p>
              <p class="muted small">le mot sera révélé à {roundLabel(round + 1)}, dans <strong class="mono">{countdown}</strong></p>
              {#if meta && round === meta.current}
                <button class="pill resume" onclick={resume}>↩️ reprendre la partie</button>
              {/if}
            {/if}
            <p>ton meilleur : <strong>{best?.word ?? "aucun"}</strong>{best ? ` (n°${best.rank})` : ""}</p>
          {/if}
          <div class="actions">
            <button class="go wide" onclick={share}>{copied ? "copié ✓" : "partager"}</button>
            <span class="muted small">prochain mot dans <strong class="mono">{countdown}</strong> ⏱</span>
          </div>
        </div>
      {/if}

      {#if game.guesses.length}
        <div class="toolbar">
          <span class="count"><strong>{tries}</strong> essai{tries > 1 ? "s" : ""}{#if hints} · {hints} 💡{/if}</span>
          {#if !over}
            <button class="pill" onclick={hint} disabled={busy || noMoreHints} title={noMoreHints ? "Tu as déjà le mot le plus proche : à toi de trouver !" : "Révèle un mot plus proche que ton meilleur essai"}><Icon name="lightbulb" /> {noMoreHints ? "plus d'indice" : "indice"}</button>
            <button class="pill" class:danger={confirmGiveUp} onclick={giveUp}>{confirmGiveUp ? "sûr ? re-clique" : "abandonner"}</button>
          {/if}
        </div>
      {/if}
    </section>

    {#if game.guesses.length}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={view === "rank"} onclick={() => (view = "rank")} title="Tes mots, du plus chaud au plus froid">🌡️ thermomètre</button>
        <button role="tab" aria-selected={view === "tracks"} onclick={() => (view = "tracks")} title="Tes mots regroupés par thème">pistes</button>
        <button role="tab" aria-selected={view === "time"} onclick={() => (view = "time")} title="Tes mots dans l'ordre où tu les as proposés">historique</button>
      </div>

      {#if view === "tracks"}
        <p class="muted small hint-text">Tes essais regroupés par thème : creuse les pistes chaudes, oublie les froides.</p>
        <div class="tracks">
          {#each tracks as t, i (t.leader.id)}
            <details class="track" open={t.leader.rank <= 2000} style:--tilt="{i % 2 ? 0.6 : -0.5}deg">
              <summary>
                <span class="track-name">{level(t.leader.rank).emoji} {t.leader.word}</span>
                <span class="muted small mono">{t.members.length} mot{t.members.length > 1 ? "s" : ""} · n°{t.leader.rank}</span>
              </summary>
              <ul class="list">
                {#each t.members as g (g.id)}<GuessRow {g} vocabSize={meta.vocabSize} compact flash={flashId === g.id} />{/each}
              </ul>
            </details>
          {/each}
        </div>
      {:else}
        <ul class="list">
          {#each view === "rank" ? byRank : byTime as g (g.id)}
            <GuessRow {g} vocabSize={meta.vocabSize} flash={flashId === g.id} />
          {/each}
        </ul>
      {/if}
    {:else if !over}
      <div class="note">
        <span class="tape" aria-hidden="true"></span>
        <p><strong>Trouve le mot secret.</strong> Chaque essai te dit à quel point tu en es proche <em>par le sens</em>.</p>
        <p class="scale">🧊 🌊 🌴 ☀️ 🥵 🔥 🎯</p>
        <p class="muted">Commence large (un animal, une émotion, un objet…), puis resserre autour des pistes chaudes.</p>
      </div>
    {/if}

    {#if over && roomWords.length}
      <section class="others">
        <h2>le parcours de la room</h2>
        {#each roomWords as p (p.name)}
          <div class="other">
            <p class="other-name">{p.name} <span class="muted small">· {p.guesses.filter((g) => !g.hint).length} essais</span></p>
            <p class="chips">
              {#each p.guesses.slice(0, 12) as g (g.id)}
                <span class="wchip" title={`n°${g.rank}`}>{level(g.rank).emoji} {g.word}{g.hint ? " 💡" : ""}</span>
              {/each}
              {#if p.guesses.length > 12}<span class="muted small">+{p.guesses.length - 12}</span>{/if}
            </p>
          </div>
        {/each}
      </section>
    {/if}

    {#if over && top.length}
      <section class="top">
        <h2>les 100 plus proches</h2>
        <ol>
          {#each top.slice(1) as t}
            <li class:mine={guessed.has(t.id)}><span class="mono muted">{t.rank}</span> {t.word}</li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if !session}
    <HistoryList
      items={pastWords}
      label={roundLabel}
      status={session ? null : (n) => loadState(LANG, soloLevel, n)}
      current={meta.current}
      onplay={(n) => { scrollTo({ top: 0, behavior: "smooth" }); openRound(n); }}
    />
    {/if}

    <footer>
      <button class="bug-card" onclick={() => bugDialog?.open()}>
        <span class="bug-emoji"><Icon name="lightbulb" size="1.9rem" /></span>
        <span><strong>Un bug, une idée ?</strong><small>Dis-le nous en deux mots</small></span>
        <span class="install-arrow"><Icon name="arrow-right" /></span>
      </button>
      <div class="theme-switch" role="radiogroup" aria-label="Thème">
        {#each [["auto", "🌓 auto"], ["light", "☀️ clair"], ["dark", "🌙 sombre"]] as [t, label] (t)}
          <button role="radio" aria-checked={theme === t} class:on={theme === t} onclick={() => setTheme(t as Theme)}>{label}</button>
        {/each}
      </div>
      <ul class="credits">
        {#each meta.credits.map(parseCredit) as c (c.text)}
          <li>
            {#if c.label}<span class="muted">{c.label}</span>{/if}
            {#if c.url}<a href={c.url} target="_blank" rel="noopener">{c.text}</a>{:else}{c.text}{/if}
            {#if c.licence}<span class="lic">{c.licence}</span>{/if}
          </li>
        {/each}
        <li><span class="muted">Inspiré de</span> <a href="https://cemantix.certitudes.org/" target="_blank" rel="noopener">Cémantix</a> et <a href="https://semantle.com/" target="_blank" rel="noopener">Semantle</a></li>
        <li><span class="muted">Code</span> <a href="https://github.com/fredericlam/Semantique" target="_blank" rel="noopener">GitHub</a> · <a href="/installer/">Installer l'app</a></li>
      </ul>
    </footer>
  {/if}
</div>

<dialog bind:this={helpDialog} onclick={(e) => e.target === helpDialog && helpDialog.close()}>
  <span class="tape" aria-hidden="true"></span>
  <h2>comment jouer</h2>
  <p><strong>Un nouveau mot secret toutes les heures.</strong> Chaque mot proposé reçoit une <strong>température</strong> : plus il est proche du secret par le sens, plus il est chaud. 100° = trouvé. Le petit <strong>n°</strong> à côté, c'est son rang (n°1 = le plus proche).</p>
  <ul class="legend">
    {#each LEVELS as l, i}
      <li><span class="emoji">{l.emoji}</span> <strong>{l.label}</strong> <span class="muted mono small">{i === 0 ? "100°" : l.maxRank === Infinity ? `< ${temperature(LEVELS[i - 1].maxRank, meta?.vocabSize ?? 28849).toFixed(0)}°` : `≥ ${temperature(l.maxRank, meta?.vocabSize ?? 28849).toFixed(0)}°`}</span></li>
    {/each}
  </ul>
  {#if SHOW_LEVELS}<p><strong>3 niveaux</strong>, chacun avec son propre mot de l'heure : <strong><LevelTag level="kid" /></strong> (7–11 ans, mots concrets, indices plus généreux), <strong><LevelTag level="teen" /></strong> et <strong><LevelTag level="adult" /></strong>.</p>{/if}
  <p>Zéro piège d'orthographe : <em>chevaux</em> = <em>cheval</em>, <em>mangeait</em> = <em>manger</em>, accents facultatifs.</p>
  <p><strong>Pistes</strong> regroupe tes essais par thème. Coincé ? <strong><Icon name="lightbulb" /> indice</strong> te donne un mot plus proche que ton meilleur.</p>
  {#if !isStandalone()}
    <a class="install-card" href="/installer/">
      <img src="/icons/icon-192.png" alt="" width="46" height="46" />
      <span class="install-text"><strong>Installe Sémantique</strong><small>sur ton écran d'accueil</small></span>
      <span class="install-arrow"><Icon name="arrow-right" /></span>
    </a>
  {/if}
  <form method="dialog"><button class="go wide">c'est parti 🌴</button></form>
</dialog>

<dialog bind:this={roomDialog} class="room-dialog" onclick={(e) => e.target === roomDialog && roomDialog.close()}>
  <span class="tape" aria-hidden="true"></span>
  {#if dialogMode === "join"}
    <h2>rejoindre la room</h2>
    <form onsubmit={(e) => { e.preventDefault(); submitJoin(false); }}>
      <label>
        <span>Joueur</span>
        <input bind:value={joinName} maxlength="20" placeholder="ton nom" autocomplete="nickname" autocapitalize="words" required />
      </label>
      <label>
        <span>Code de la room</span>
        <input class="code-input" bind:value={joinCode} oninput={() => (joinCode = cleanCode(joinCode))} maxlength="5" placeholder="ex. PALM7" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      </label>
      {#if joinError}<p class="err">{joinError}</p>{/if}
      <button class="go wide" type="submit" disabled={joinBusy || joinCode.length !== 5}>rejoindre la room</button>
    </form>
    <button class="switch" onclick={() => ((dialogMode = "create"), (joinError = ""))}>✨ plutôt créer une room</button>
  {:else}
    <h2>créer une room</h2>
    <form onsubmit={(e) => { e.preventDefault(); submitJoin(true); }}>
      <label>
        <span>Joueur</span>
        <input bind:value={joinName} maxlength="20" placeholder="ton nom" autocomplete="nickname" autocapitalize="words" required />
      </label>
      <label>
        <span>Nom de la room <span class="muted">(facultatif)</span></span>
        <input bind:value={roomName} maxlength="30" placeholder="ex. Les Flamants roses" autocomplete="off" />
      </label>
      {#if SHOW_LEVELS}
      <fieldset class="vis">
        <legend>Niveau</legend>
        <div class="levels in-dialog" role="radiogroup" aria-label="Niveau de la room">
          {#each meta?.levels ?? ["adult"] as l (l)}
            <button type="button" role="radio" aria-checked={createLevel === l} class:on={createLevel === l} onclick={() => (createLevel = l)}><LevelTag level={l} /></button>
          {/each}
        </div>
      </fieldset>
      {/if}
      <fieldset class="vis">
        <legend>Visibilité</legend>
        <label class:on={roomVisibility === "public"}>
          <input type="radio" bind:group={roomVisibility} value="public" />
          <strong>🌍 publique</strong><span>visible dans la liste, tout le monde peut entrer</span>
        </label>
        <label class:on={roomVisibility === "private"}>
          <input type="radio" bind:group={roomVisibility} value="private" />
          <strong>🔒 privée</strong><span>uniquement avec le code</span>
        </label>
      </fieldset>
      {#if joinError}<p class="err">{joinError}</p>{/if}
      <button class="go wide" type="submit" disabled={joinBusy}>✨ créer la room</button>
    </form>
    <button class="switch" onclick={() => ((dialogMode = "join"), (joinError = ""))}>🔑 j'ai déjà un code</button>
  {/if}
</dialog>

<BugDialog bind:this={bugDialog} context={bugContext} />

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}<div class="toast">{t.text}</div>{/each}
</div>

<dialog bind:this={statsDialog} onclick={(e) => e.target === statsDialog && statsDialog.close()}>
  <span class="tape" aria-hidden="true"></span>
  <h2>tes stats</h2>
  {#if stats}
    <div class="stats">
      <div><strong>{stats.played}</strong><span>parties</span></div>
      <div><strong>{stats.won}</strong><span>trouvés</span></div>
      <div><strong>{stats.today}</strong><span>auj.</span></div>
      <div><strong>{stats.bestTries ?? "–"}</strong><span>record</span></div>
      <div><strong>{stats.avgTries ?? "–"}</strong><span>essais moy.</span></div>
    </div>
  {/if}
  <form method="dialog"><button class="go wide">fermer</button></form>
</dialog>

<style>
  .page { max-width: 520px; margin: 0 auto; padding: 0 16px calc(48px + env(safe-area-inset-bottom)); }

  /* ---------- header: neon sign over a striped sunset ---------- */
  header { position: relative; display: flex; align-items: center; gap: 0.5rem; padding: 22px 0 14px; }
  .sun {
    position: absolute; left: 50%; top: 4px; width: 132px; height: 132px; translate: -50% 0; z-index: -1;
    border-radius: 50%;
    background: linear-gradient(180deg, var(--sun-a), var(--sun-b));
    mask-image: linear-gradient(180deg, black 52%, transparent 52% 58%, black 58% 66%, transparent 66% 71%, black 71% 78%, transparent 78% 82%, black 82% 88%, transparent 88%);
    opacity: 0.85;
  }
  .palm { position: absolute; right: 0; top: 6px; width: 46px; color: var(--purple); opacity: 0.25; z-index: -1; rotate: 8deg; }
  .brand { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
  h1 {
    font-family: var(--script); font-weight: 400; font-size: 2.9rem; line-height: 1; margin: 0;
    color: var(--pink); rotate: -4deg; padding: 0 0.15em;
    text-shadow: 2px 2px 0 var(--ink), 4px 4px 0 var(--teal), var(--title-glow);
  }
  .day {
    font-family: var(--mono); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
    background: var(--teal); color: #10233a; padding: 0.15rem 0.55rem; border-radius: 4px; margin: 0.35rem 0 0 1.4rem; rotate: 3deg;
    box-shadow: var(--shadow-sm);
  }
  .header-actions { display: flex; gap: 0.4rem; align-items: center; flex: none; }
  .day { white-space: nowrap; }
  .sep { opacity: 0.6; }
  .timer { font-variant-numeric: tabular-nums; }
  .banner {
    display: flex; gap: 0.5rem; align-items: center; justify-content: center; width: 100%; margin-bottom: 8px;
    background: linear-gradient(90deg, var(--sun-a), var(--pink)); color: #2a1440; font-weight: 600;
    border: 2px solid var(--line); border-radius: 14px; padding: 0.6rem; box-shadow: var(--shadow-sm);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { transform: scale(1.015); } }
  .icon {
    width: 2.6rem; height: 2.6rem; border-radius: 50%; border: 2px solid var(--line); background: var(--panel);
    font-weight: 800; font-size: 1.05rem; box-shadow: var(--shadow-sm);
  }
  .icon:active { translate: 2px 2px; box-shadow: none; }
  a.icon { display: grid; place-items: center; text-decoration: none; }
  /* phones: 3 round buttons max; install is reachable from the help dialog */
  @media (max-width: 480px) {
    .icon.install { display: none; }
    .icon { width: 2.3rem; height: 2.3rem; font-size: 0.95rem; }
    h1 { font-size: 2.45rem; }
    .day { margin-left: 0.9rem; font-size: 0.66rem; letter-spacing: 0.08em; }
  }
  .page { padding-top: env(safe-area-inset-top); }

  /* ---------- sticky console ---------- */
  .console {
    position: sticky; top: 0; z-index: 3; padding: 10px 0 8px; margin: 0 -16px 12px; padding-inline: 16px;
    background: linear-gradient(180deg, var(--sky-top) 82%, transparent);
  }
  form { display: flex; gap: 0.55rem; }
  input {
    flex: 1; min-width: 0; font: inherit; font-size: 1.15rem; font-weight: 600; padding: 0.8rem 1rem;
    border: 2px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--ink); box-shadow: var(--shadow);
  }
  input::placeholder { color: var(--muted); font-weight: 400; }
  input:focus { outline: none; border-color: var(--pink); }
  .go {
    font-family: var(--mono); font-weight: 700; letter-spacing: 0.08em; font-size: 1rem;
    background: var(--pink); color: white; border: 2px solid var(--line); border-radius: 16px; padding: 0 1.15rem;
    box-shadow: var(--shadow); transition: translate 0.08s, box-shadow 0.08s;
  }
  .go:not(:disabled):active { translate: 3px 3px; box-shadow: none; }
  .go.wide { padding: 0.75rem 1.4rem; text-transform: uppercase; }
  .feedback { min-height: 1.7rem; padding: 0.45rem 0.2rem 0; font-size: 0.9rem; line-height: 1.9; }
  .err { color: var(--pink); font-weight: 600; }
  .chip {
    background: var(--panel); border: 2px solid var(--line); border-radius: 99px; padding: 0 0.65rem; margin: 0 0.1rem;
    font-weight: 700; box-shadow: var(--shadow-sm);
  }
  .last { margin: 4px 0 0; padding: 0; }
  .toolbar { display: flex; align-items: center; gap: 0.45rem; padding-top: 12px; }
  .count { flex: 1; font-size: 0.9rem; }
  .count strong { font-family: var(--mono); font-size: 1.1rem; }
  .pill {
    background: var(--panel); border: 2px solid var(--line); border-radius: 99px; padding: 0.3rem 0.8rem;
    font-size: 0.85rem; font-weight: 600;
  }
  .pill.danger { background: var(--pink); color: white; }

  /* ---------- tabs ---------- */
  .tabs { display: flex; gap: 0.3rem; padding: 4px; background: var(--panel-2); border: 2px solid var(--line); border-radius: 99px; margin-bottom: 12px; }
  .tabs button { flex: 1; background: none; border: 0; border-radius: 99px; padding: 0.45rem 0.4rem; font-weight: 600; font-size: 0.9rem; color: var(--muted); }
  .tabs button[aria-selected="true"] { background: var(--ink); color: var(--panel); }

  .list { margin: 0; padding: 0; display: grid; gap: 6px; }
  .hint-text { margin: 0 0 10px; }

  /* ---------- tracks: sticky notes pinned on the wall ---------- */
  .tracks { display: grid; gap: 14px; }
  .track { background: var(--panel-2); border: 2px solid var(--line); border-radius: 6px 18px 6px 18px; padding: 0.35rem 0.5rem 0.5rem; rotate: var(--tilt); box-shadow: var(--shadow-sm); }
  .track summary { cursor: pointer; display: flex; gap: 0.6rem; align-items: baseline; justify-content: space-between; padding: 0.35rem 0.3rem 0.45rem; }
  .track-name { font-weight: 800; font-size: 1.05rem; }
  .track .list { gap: 4px; }

  /* ---------- notes, polaroid, tape ---------- */
  .note, .polaroid, dialog { position: relative; }
  .note {
    background: var(--panel); border: 2px solid var(--line); border-radius: 4px; padding: 0.9rem 1.1rem 0.6rem;
    rotate: -0.8deg; box-shadow: var(--shadow); margin-top: 14px;
  }
  .note p { margin: 0 0 0.7rem; line-height: 1.45; }
  .scale { font-size: 1.4rem; letter-spacing: 0.25em; }
  .tape {
    position: absolute; top: -12px; left: 50%; width: 96px; height: 24px; translate: -50% 0; rotate: -3deg;
    background: repeating-linear-gradient(45deg, var(--tape) 0 8px, color-mix(in srgb, var(--tape) 70%, white) 8px 16px);
    border-radius: 2px; opacity: 0.95;
  }
  .polaroid {
    background: var(--panel); border: 2px solid var(--line); border-radius: 4px; padding: 1.2rem 1rem 1rem;
    text-align: center; rotate: 1deg; box-shadow: var(--shadow); margin-top: 12px;
  }
  .polaroid p { margin: 0.2rem 0; }
  .kicker { font-family: var(--mono); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); }
  .secret {
    font-family: var(--script); font-size: 3.2rem; line-height: 1.1; color: var(--pink);
    text-shadow: 2px 2px 0 var(--ink), 4px 4px 0 var(--teal), var(--title-glow);
  }
  .end.won { background: linear-gradient(160deg, var(--panel), var(--pink-soft)); }
  .actions { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; margin-top: 0.9rem; }

  .top h2, dialog h2 { font-family: var(--script); font-weight: 400; font-size: 2rem; color: var(--pink); margin: 1.6rem 0 0.4rem; text-shadow: 1px 1px 0 var(--ink); }
  .top ol { list-style: none; padding: 0; columns: 2; column-gap: 1rem; font-size: 0.92rem; }
  .top li { padding: 0.15rem 0; break-inside: avoid; }
  .top li .mono { display: inline-block; width: 2rem; text-align: right; margin-right: 0.35rem; font-size: 0.75rem; }
  .top li.mine { font-weight: 800; color: var(--pink); }

  .muted { color: var(--muted); }
  .small { font-size: 0.82rem; }
  .mono { font-family: var(--mono); }
  .loading { padding: 3rem 0; text-align: center; font-family: var(--mono); }
  .error-box { color: var(--pink); }
  footer { margin-top: 3rem; color: var(--muted); font-size: 0.72rem; line-height: 1.5; }

  dialog {
    border: 2px solid var(--line); border-radius: 6px; padding: 0.6rem 1.4rem 1.3rem; overflow: visible;
    width: min(440px, calc(100vw - 32px)); background: var(--panel); color: var(--ink); box-shadow: var(--shadow); rotate: -0.6deg;
  }
  dialog h2 { margin-top: 0.8rem; }
  dialog p { line-height: 1.45; }
  dialog form { display: flex; justify-content: center; margin-top: 1rem; }
  dialog::backdrop { background: rgb(42 20 64 / 0.55); backdrop-filter: blur(3px); }
  .legend { list-style: none; padding: 0; display: grid; gap: 0.3rem; }
  .legend .emoji { display: inline-block; width: 1.6rem; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.4rem; text-align: center; margin: 0.8rem 0; }
  .stats div { display: flex; flex-direction: column; gap: 0.15rem; }
  .stats strong { font-family: var(--mono); font-size: 1.6rem; color: var(--pink); }
  .stats span { font-size: 0.7rem; color: var(--muted); }

  .icon.active { background: var(--pink); color: white; }
  .levels { display: flex; gap: 4px; padding: 4px; margin: 2px 0 10px; background: var(--panel-2); border: 2px solid var(--line); border-radius: 99px; }
  .levels button { flex: 1; border: 0; background: none; border-radius: 99px; padding: 0.4rem 0.3rem; font-weight: 700; font-size: 0.88rem; color: var(--muted); white-space: nowrap; }
  .levels button.on { background: var(--pink); color: white; box-shadow: var(--shadow-sm); }
  .levels.in-dialog { margin: 0; }
  .room-back { background: none; border: 0; padding: 0.2rem 0; margin: 0 0 4px; font-weight: 700; color: var(--muted); display: inline-flex; align-items: center; gap: 0.3rem; }
  .room-cta {
    display: flex; align-items: center; gap: 0.75rem; width: 100%; margin: 4px 0 12px; padding: 0.6rem 0.9rem; text-align: left;
    background: var(--panel); border: 2px solid var(--line); border-radius: 16px; box-shadow: var(--shadow-sm); color: var(--ink);
    rotate: -0.5deg; transition: translate 0.1s;
  }
  .room-cta:active { translate: 2px 2px; box-shadow: none; }
  .cta-emoji, .bug-emoji { display: inline-flex; color: var(--pink); }
  .home { color: inherit; text-decoration: none; }
  .cta-text { flex: 1; display: grid; line-height: 1.25; }
  .cta-text strong { font-size: 1rem; }
  .cta-text small { color: var(--muted); font-size: 0.8rem; }

  .room-dialog form { display: grid; gap: 0.75rem; margin-top: 0.8rem; justify-content: stretch; }
  .room-dialog label { display: grid; gap: 0.3rem; font-weight: 600; font-size: 0.85rem; }
  .room-dialog input { box-shadow: var(--shadow-sm); font-size: 1.05rem; padding: 0.65rem 0.85rem; }
  .code-input { font-family: var(--mono); letter-spacing: 0.3em; text-transform: uppercase; }
  .room-dialog .go { width: 100%; padding: 0.8rem; }
  .theme-switch { display: flex; gap: 3px; padding: 3px; margin: 0 auto 1rem; width: fit-content; background: var(--panel-2); border-radius: 99px; }
  .theme-switch button { border: 0; background: none; border-radius: 99px; padding: 0.3rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: var(--muted); }
  .theme-switch button.on { background: var(--ink); color: var(--panel); }
  .credits { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; text-align: center; font-size: 0.78rem; }
  .credits a { color: var(--ink); font-weight: 600; text-decoration-color: var(--pink); text-underline-offset: 2px; }
  .credits a:hover { color: var(--pink); }
  .credits .lic { font-family: var(--mono); font-size: 0.65rem; border: 1px solid currentColor; border-radius: 4px; padding: 0 0.25rem; margin-left: 0.25rem; color: var(--muted); }
  .bug-card {
    display: flex; align-items: center; gap: 0.75rem; width: 100%; margin: 0 0 1.2rem; padding: 0.6rem 0.85rem; text-align: left;
    background: var(--panel); border: 2px dashed var(--line); border-radius: 16px; color: var(--ink); rotate: 0.5deg; font-size: 0.95rem;
  }
  .bug-card span:nth-child(2) { flex: 1; display: grid; line-height: 1.25; }
  .bug-card small { color: var(--muted); font-size: 0.8rem; }

  .install-card {
    display: flex; align-items: center; gap: 0.8rem; margin: 1rem 0 0.2rem; padding: 0.6rem 0.8rem;
    background: var(--panel-2); border: 2px solid var(--line); border-radius: 16px; box-shadow: var(--shadow-sm);
    color: var(--ink); text-decoration: none; rotate: -0.6deg; transition: translate 0.1s;
  }
  .install-card:hover { translate: 0 -1px; }
  .install-card:active { translate: 2px 2px; box-shadow: none; }
  .install-card img { border-radius: 11px; border: 2px solid var(--line); flex: none; }
  .install-text { flex: 1; display: grid; line-height: 1.25; }
  .install-text small { color: var(--muted); font-size: 0.82rem; }
  .install-arrow { display: inline-flex; font-size: 1.2rem; color: var(--pink); }
  .switch { display: block; margin: 0.9rem auto 0; background: none; border: 0; font-weight: 700; color: var(--pink); }
  .vis { border: 0; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
  .vis legend { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.3rem; }
  .vis label {
    display: grid; grid-template-columns: auto 1fr; column-gap: 0.5rem; align-items: center; cursor: pointer;
    border: 2px solid var(--panel-2); border-radius: 12px; padding: 0.5rem 0.7rem; font-weight: 400;
  }
  .vis label.on { border-color: var(--pink); background: var(--pink-soft); }
  .vis input { grid-row: span 2; accent-color: var(--pink); box-shadow: none; }
  .vis span { grid-column: 2; font-size: 0.78rem; color: var(--muted); }
  .resume { margin-top: 0.6rem; background: var(--panel); border: 2px solid var(--line); border-radius: 99px; padding: 0.45rem 1rem; font-weight: 700; box-shadow: var(--shadow-sm); }

  .toasts { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom)); translate: -50% 0; z-index: 20; display: grid; gap: 0.4rem; width: min(420px, calc(100vw - 32px)); pointer-events: none; }
  .toast {
    background: var(--ink); color: var(--panel); border-radius: 12px; padding: 0.65rem 0.9rem; font-weight: 600; font-size: 0.92rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); animation: pop 0.35s cubic-bezier(.2,.9,.3,1.3);
  }
  @keyframes pop { from { translate: 0 20px; opacity: 0; scale: 0.9; } }

  .others h2 { font-family: var(--script); font-weight: 400; font-size: 2rem; color: var(--pink); margin: 1.6rem 0 0.4rem; text-shadow: 1px 1px 0 var(--ink); }
  .other { background: var(--panel); border: 2px solid var(--line); border-radius: 10px; padding: 0.5rem 0.7rem; margin-bottom: 0.6rem; }
  .other-name { margin: 0 0 0.35rem; font-weight: 800; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0; }
  .wchip { background: var(--panel-2); border-radius: 99px; padding: 0.1rem 0.55rem; font-size: 0.82rem; }

  @media (max-width: 380px) {
    h1 { font-size: 2.4rem; }
    .go { padding: 0 0.9rem; }
  }
</style>
