import type { Env } from "./env.ts";

/** Bug reports from the app → GitHub issues (the token stays on the server). */

export interface BugReport {
  text: string;
  context?: Record<string, string | number | boolean | null>;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const recent = new Map<string, number[]>(); // per-isolate, good enough against accidental floods

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return false;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function issueFrom(report: BugReport): { title: string; body: string } {
  const text = report.text.trim();
  const firstLine = text.split("\n")[0];
  const ctx = Object.entries(report.context ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `| ${clip(String(k), 40)} | ${clip(String(v).replace(/\|/g, "/").replace(/\n/g, " "), 200)} |`)
    .join("\n");
  return {
    title: `🐞 ${clip(firstLine, 80)}`,
    body: [
      "**Signalé depuis l'app**",
      "",
      text.split("\n").map((l) => `> ${l}`).join("\n"),
      "",
      ctx ? `<details><summary>Infos techniques</summary>\n\n| | |\n|---|---|\n${ctx}\n\n</details>` : "",
    ].join("\n"),
  };
}

export async function createIssue(env: Env, report: BugReport): Promise<{ url: string } | { error: string; status: number }> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { error: "not_configured", status: 503 };
  const { title, body } = issueFrom(report);
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "semantique-bug-reporter",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["bug"] }),
  });
  if (!r.ok) return { error: "github", status: 502 };
  const issue = await r.json<{ html_url: string }>();
  return { url: issue.html_url };
}
