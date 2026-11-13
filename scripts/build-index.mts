// Turns the raw crawl into the palette index the app searches.
// Run: npm run build-index   (after npm run crawl)
//
// Fast and offline, so palette/matching tweaks never need a re-crawl.

import { readFileSync, writeFileSync } from "node:fs";
import { GifReader } from "omggif";
import { buildVividCurve, chroma, extractPalette, hueScore, labWheelHue, MATCH, swatchFeatures, type Swatch } from "../lib/palette";

const RAW = "data/raw/works.jsonl";
const OUT = "data/palettes.json";

type RawWork = { id: number; type: number | null; boosted: 0 | 1; lqip: string | null; aic: [number, number, number, number] | null };

const started = Date.now();
const raw: RawWork[] = readFileSync(RAW, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));

let failed = 0;
const works = raw.map((w) => {
  let palette: Swatch[] = [];
  if (w.lqip) {
    try {
      const gif = new GifReader(Buffer.from(w.lqip.split(",")[1], "base64"));
      const px = new Uint8Array(gif.width * gif.height * 4);
      gif.decodeAndBlitFrameRGBA(0, px);
      palette = extractPalette(px);
    } catch {
      failed++;
    }
  }
  // The museum's HSL saturation calls near-black and near-white "saturated",
  // so only trust its accent in the mid tones.
  const accent = w.aic && w.aic[1] >= 35 && w.aic[2] >= 20 && w.aic[2] <= 85 ? w.aic[0] : -1;
  return { ...w, palette, accent };
});

const curve = buildVividCurve(
  works.flatMap((w) => w.palette.map((s) => ({ hue: labWheelHue(s), chroma: chroma(s[1], s[2]), weight: s[3] / 100 }))),
);

// Compact on disk: [id, typeId, boosted, accentHue (-1 = none), L,a,b,w, L,a,b,w, ...]
const index = {
  builtAt: new Date().toISOString(),
  match: MATCH,
  curve,
  works: works
    .filter((w) => w.palette.length)
    .map((w) => [w.id, w.type ?? 0, w.boosted, w.accent, ...w.palette.flat()]),
};
writeFileSync(OUT, JSON.stringify(index));

// ---- report -----------------------------------------------------------------

const feats = works.map((w) => w.palette.map((s) => ({ ...swatchFeatures(s, curve), weight: s[3] / 100 })));
const aicHit = (w: RawWork, h: number) => w.aic !== null && w.aic[1] >= 30 && Math.abs(((w.aic[0] - h + 540) % 360) - 180) <= 12;

console.log(`${works.length} works → ${index.works.length} palettes (${failed} undecodable) in ${Date.now() - started}ms`);
console.log(`${OUT}: ${(JSON.stringify(index).length / 1e6).toFixed(1)} MB · avg ${(index.works.reduce((s, w) => s + (w.length - 4) / 4, 0) / index.works.length).toFixed(1)} swatches`);
console.log(`chroma floor by 30°: ${curve.floor.filter((_, i) => i % 3 === 0).join(" ")}`);
console.log(`chroma full  by 30°: ${curve.full.filter((_, i) => i % 3 === 0).join(" ")}\n`);
console.log("wheel°   museum-only   palette-only   combined");
for (let h = 0; h < 360; h += 15) {
  const paletteOnly = feats.filter((f) => hueScore(f, h) >= MATCH.threshold).length;
  const combined = feats.filter((f, i) => hueScore(f, h, works[i].accent) >= MATCH.threshold).length;
  console.log(`${String(h).padStart(5)}  ${String(works.filter((w) => aicHit(w, h)).length).padStart(11)}  ${String(paletteOnly).padStart(13)}  ${String(combined).padStart(9)}`);
}
