// App icon: light retro sunset + neon "S" + SÉMANTIQUE label.
// Letters are converted to SVG paths (opentype.js) so the icon renders identically everywhere.
//   node scripts/icons.mjs   →  assets/icon.svg + public/icons/*.png
import sharp from "sharp";
import opentype from "opentype.js";
import { readFile, writeFile } from "node:fs/promises";

const here = (p) => new URL(`../${p}`, import.meta.url);
const font = async (f) => opentype.parse((await readFile(here(`assets/fonts/${f}`))).buffer);
const script = await font("Yellowtail.ttf");
const mono = await font("Space_Mono_wght_700.ttf");

/** Glyph-by-glyph layout (opentype.js text shaping chokes on some GSUB tables). */
function layout(f, text, size, x, y, letterSpacing = 0) {
  const path = new opentype.Path();
  for (const ch of text) {
    const g = f.charToGlyph(ch);
    path.extend(g.getPath(x, y, size));
    x += (g.advanceWidth * size) / f.unitsPerEm + letterSpacing * size;
  }
  return path;
}

/** Path data for `text`, its bounding box centred on (cx, cy) — or on baseline cy if baseline=true. */
function centred(f, text, size, cx, cy, { letterSpacing = 0, baseline = false } = {}) {
  const bb = layout(f, text, size, 0, 0, letterSpacing).getBoundingBox();
  const x = cx - (bb.x1 + bb.x2) / 2;
  const y = baseline ? cy : cy - (bb.y1 + bb.y2) / 2;
  return layout(f, text, size, x, y, letterSpacing).toPathData(2);
}

// --- big neon S, visually centred on the sun
const S = centred(script, "S", 400, 250, 262);
const label = centred(mono, "SÉMANTIQUE", 38, 256, 475, { letterSpacing: 0.12, baseline: true });

const icon = (withLabel = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3e6"/>
      <stop offset="0.55" stop-color="#ffd6c2"/>
      <stop offset="1" stop-color="#ffb8c6"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe066"/>
      <stop offset="0.5" stop-color="#ffab5e"/>
      <stop offset="1" stop-color="#ff6fa3"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffa3c2"/>
      <stop offset="1" stop-color="#ff7fae"/>
    </linearGradient>
    <mask id="stripes">
      <rect width="512" height="512" fill="white"/>
      <rect x="0" y="262" width="512" height="8" fill="black"/>
      <rect x="0" y="286" width="512" height="11" fill="black"/>
      <rect x="0" y="312" width="512" height="14" fill="black"/>
    </mask>
    <clipPath id="below"><rect x="0" y="344" width="512" height="168"/></clipPath>
  </defs>

  <rect width="512" height="512" fill="url(#sky)"/>
  <g fill="#ffffff" opacity="0.9">
    <path d="M92 74l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/>
    <path d="M428 104l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>
    <circle cx="400" cy="58" r="3"/><circle cx="120" cy="150" r="2.5"/>
  </g>
  <circle cx="256" cy="232" r="150" fill="url(#sun)" mask="url(#stripes)"/>

  <rect x="0" y="344" width="512" height="168" fill="url(#floor)"/>
  <g clip-path="url(#below)" stroke="#ffffff" stroke-width="3" opacity="0.6" fill="none">
    <line x1="0" y1="364" x2="512" y2="364"/><line x1="0" y1="392" x2="512" y2="392"/>
    <line x1="0" y1="430" x2="512" y2="430"/>
    <line x1="256" y1="344" x2="256" y2="512"/>
    <line x1="256" y1="344" x2="120" y2="512"/><line x1="256" y1="344" x2="392" y2="512"/>
    <line x1="256" y1="344" x2="-20" y2="512"/><line x1="256" y1="344" x2="532" y2="512"/>
  </g>
  <line x1="0" y1="344" x2="512" y2="344" stroke="#ff3d8b" stroke-width="5"/>

  <!-- neon S: teal drop, white outline, hot pink fill -->
  <path d="${S}" fill="#12c2c4" transform="translate(12 12)"/>
  <path d="${S}" fill="#ff2d7f" stroke="#ffffff" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>

  ${withLabel ? `<!-- label tape -->
  <rect x="78" y="436" width="356" height="52" rx="8" fill="#ff3d8b" transform="rotate(-3 256 462)"/>
  <path d="${label}" fill="#ffffff" transform="rotate(-3 256 462)"/>` : ""}
</svg>
`;
const svg = icon(true);
// Android crops "maskable" icons to a circle/squircle: the label would be cut, keep only the S.
const maskable = icon(false);

await writeFile(here("assets/icon.svg"), svg);
await writeFile(here("public/icons/icon.svg"), svg);

const out = (f) => here(`public/icons/${f}`).pathname;
const jobs = [
  [svg, 192, "icon-192.png"],
  [svg, 512, "icon-512.png"],
  [svg, 180, "apple-touch-icon.png"],
  [maskable, 32, "favicon-32.png"],
  [maskable, 512, "maskable-512.png"],
];
for (const [src, size, name] of jobs) await sharp(Buffer.from(src), { density: 300 }).resize(size, size).png().toFile(out(name));
console.log("icons →", jobs.map((j) => j[2]).join(", "));
