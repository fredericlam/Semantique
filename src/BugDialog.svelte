<script lang="ts">
  /** "🐞 signaler un bug" → GitHub issue, created by the server (no GitHub account needed). */
  let { context }: { context: () => Record<string, string | number | boolean | null> } = $props();

  let dialog: HTMLDialogElement;
  let text = $state("");
  let withInfo = $state(true);
  let status = $state<"idle" | "sending" | "done" | "error">("idle");
  let message = $state("");
  let issueUrl = $state("");

  export function open() {
    status = "idle";
    message = "";
    dialog.showModal();
  }

  function fallbackUrl(repo: string) {
    const ctx = withInfo ? Object.entries(context()).map(([k, v]) => `- ${k} : ${v}`).join("\n") : "";
    const body = `${text}\n\n${ctx}`;
    return `https://github.com/${repo}/issues/new?labels=bug&title=${encodeURIComponent("🐞 " + text.split("\n")[0].slice(0, 80))}&body=${encodeURIComponent(body)}`;
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (text.trim().length < 5) return;
    status = "sending";
    try {
      const r = await fetch("/api/bug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, context: withInfo ? context() : undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        status = "done";
        issueUrl = data.url;
        text = "";
      } else if (data.error === "not_configured" && data.repo) {
        // no server token: hand over to GitHub's own form, pre-filled
        open_(fallbackUrl(data.repo));
        status = "idle";
        dialog.close();
      } else {
        status = "error";
        message = data.error === "too_many" ? "Doucement 🙂 réessaie dans quelques minutes." : "Envoi impossible, réessaie plus tard.";
      }
    } catch {
      status = "error";
      message = "Pas de connexion, réessaie plus tard.";
    }
  }
  const open_ = (url: string) => window.open(url, "_blank", "noopener");
</script>

<dialog bind:this={dialog} class="bug" onclick={(e) => e.target === dialog && dialog.close()}>
  <span class="tape" aria-hidden="true"></span>
  <h2>🐞 un bug ?</h2>
  {#if status === "done"}
    <p class="ok">Merci ! C'est noté 🙏</p>
    <p class="small"><a href={issueUrl} target="_blank" rel="noopener">Suivre le signalement sur GitHub →</a></p>
    <form method="dialog"><button class="go wide">fermer</button></form>
  {:else}
    <form onsubmit={send}>
      <label>
        <span>Qu'est-ce qui ne va pas ?</span>
        <textarea bind:value={text} rows="5" maxlength="2000" placeholder="Ex. : en tapant « pêche », j'ai eu… alors que je m'attendais à…" required></textarea>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={withInfo} />
        <span>Joindre les infos techniques (version, page, appareil). Jamais ton code de room ni tes mots.</span>
      </label>
      <p class="small muted">Le signalement est publié sur GitHub : n'y mets pas d'infos personnelles.</p>
      {#if message}<p class="err">{message}</p>{/if}
      <button class="go wide" type="submit" disabled={status === "sending" || text.trim().length < 5}>
        {status === "sending" ? "envoi…" : "envoyer"}
      </button>
    </form>
  {/if}
</dialog>

<style>
  .bug form { display: grid; gap: 0.8rem; margin-top: 0.6rem; }
  label { display: grid; gap: 0.35rem; font-weight: 600; font-size: 0.88rem; }
  textarea {
    font: inherit; font-weight: 400; font-size: 1rem; padding: 0.7rem 0.85rem; resize: vertical;
    border: 2px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--ink); box-shadow: var(--shadow-sm);
  }
  textarea:focus { outline: none; border-color: var(--pink); }
  .check { grid-template-columns: auto 1fr; align-items: start; font-weight: 400; font-size: 0.8rem; color: var(--muted); }
  .check input { accent-color: var(--pink); margin-top: 0.15rem; }
  .ok { font-size: 1.1rem; font-weight: 700; }
  .small { font-size: 0.8rem; margin: 0; }
  .muted { color: var(--muted); }
  .err { color: var(--pink); font-weight: 600; margin: 0; }
  .go { width: 100%; }
</style>
