// Upload game data to the R2 bucket: node scripts/seed.mjs [--remote] [lang=fr]
// --local (default) seeds the bucket simulated by `wrangler dev`; --remote seeds the real one.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BUCKET = "semantique-data";
const remote = process.argv.includes("--remote");
const lang = process.argv.find((a) => /^[a-z]{2}$/.test(a)) ?? "fr";
const root = join(import.meta.dirname, "..", "data", "out");

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const all = files(join(root, lang));
for (const [i, file] of all.entries()) {
  const key = relative(root, file);
  process.stdout.write(`[${i + 1}/${all.length}] ${key}\n`);
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, remote ? "--remote" : "--local"], { stdio: ["ignore", "ignore", "inherit"] });
}
console.log(`✓ ${all.length} files → ${remote ? "R2 (remote)" : "local R2"}`);
