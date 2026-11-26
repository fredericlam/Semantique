// Upload game data to the R2 bucket: node scripts/seed.mjs [--remote] [lang=fr] [--only fr/private/kid]
// --local (default) seeds the bucket simulated by `wrangler dev`; --remote seeds the real one.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BUCKET = "semantique-data";
const remote = process.argv.includes("--remote");
const lang = process.argv.find((a) => /^[a-z]{2}$/.test(a)) ?? "fr";
const root = join(import.meta.dirname, "..", "data", "out");

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
// --from N resumes an interrupted upload at file N (1-based); --only <path> uploads one sub-folder (e.g. fr/private/kid)
const from = Number(process.argv[process.argv.indexOf("--from") + 1]) || 1;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const all = files(join(root, lang))
  .filter((f) => !only || relative(root, f).startsWith(only))
  .slice(process.argv.includes("--from") ? from - 1 : 0);
for (const [i, file] of all.entries()) {
  const key = relative(root, file);
  process.stdout.write(`[${i + 1}/${all.length}] ${key}\n`);
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, remote ? "--remote" : "--local"], { stdio: ["ignore", "ignore", "pipe"] });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      process.stdout.write(`   retry ${attempt}/2 (${String(e.stderr ?? e.message).split("\n").find((l) => /ERROR|error/.test(l))?.trim() ?? "error"})\n`);
      execFileSync("sleep", [String(5 * attempt)]);
    }
  }
}
console.log(`✓ ${all.length} files → ${remote ? "R2 (remote)" : "local R2"}`);
