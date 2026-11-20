// Rasterise assets/icon.svg into the PWA icon set: node scripts/icons.mjs
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(new URL("../assets/icon.svg", import.meta.url));
const out = (f) => new URL(`../public/icons/${f}`, import.meta.url).pathname;

// Maskable: the sun and palm already sit inside the 80% safe zone; only leaf tips get cropped by round masks.
const maskable = svg;

const jobs = [
  [svg, 192, "icon-192.png"],
  [svg, 512, "icon-512.png"],
  [svg, 180, "apple-touch-icon.png"],
  [svg, 32, "favicon-32.png"],
  [maskable, 512, "maskable-512.png"],
];
for (const [src, size, name] of jobs) await sharp(src, { density: 300 }).resize(size, size).png().toFile(out(name));
await writeFile(out("icon.svg"), svg);
console.log("icons →", jobs.map((j) => j[2]).join(", "));
