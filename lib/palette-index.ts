// Server-side color search over data/palettes.json (built by
// scripts/build-index.mts). Loaded once per server process into flat typed
// arrays: scoring all ~58k works for a hue is a tight loop over ~200k swatches,
// a few milliseconds, so there's no need for a database.

import { readFileSync } from "node:fs";
import path from "node:path";
import { TYPES, type TypeKey } from "./catalog";
import { HISTOGRAM_STEP } from "./color";
import { accentScore, hueDistance, labToRgb, MATCH, swatchFeatures, type VividCurve } from "./palette";

const BUCKETS = 360 / HISTOGRAM_STEP;
// With two colors, each only has to cover part of the work.
const PAIR_THRESHOLD = 0.06;
// Featured works (the museum's highlights) rank higher at equal color strength.
const BOOST = 1.6;
const CACHE_ENTRIES = 200;
// The museum's previews are blurrier and greyer than the works: against 64px
// renders of the real images, measured chroma ran ~35% low. Displayed
// swatches get that back so the palette bar matches the painting next to it.
// (Matching doesn't need it: colorfulness there is relative to the collection.)
const DISPLAY_CHROMA = 1.35;

type Index = {
  ids: Int32Array;
  types: Uint8Array;
  boosted: Uint8Array;
  /** The museum's accent color as a wheel hue, or -1. */
  accent: Int16Array;
  /** Swatches of work i are start[i] .. start[i + 1] - 1. */
  start: Uint32Array;
  hue: Float32Array;
  vivid: Float32Array;
  weight: Float32Array;
  rgb: Uint8Array;
  byId: Map<number, number>;
};

let loaded: Index | null = null;

function index(): Index {
  if (loaded) return loaded;
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "data/palettes.json"), "utf8")) as {
    curve: VividCurve;
    works: number[][];
  };
  const n = file.works.length;
  const swatches = file.works.reduce((s, w) => s + (w.length - 4) / 4, 0);
  const ix: Index = {
    ids: new Int32Array(n),
    types: new Uint8Array(n),
    boosted: new Uint8Array(n),
    accent: new Int16Array(n),
    start: new Uint32Array(n + 1),
    hue: new Float32Array(swatches),
    vivid: new Float32Array(swatches),
    weight: new Float32Array(swatches),
    rgb: new Uint8Array(swatches * 3),
    byId: new Map(),
  };
  let s = 0;
  file.works.forEach((w, i) => {
    ix.ids[i] = w[0];
    ix.types[i] = w[1];
    ix.boosted[i] = w[2];
    ix.accent[i] = w[3];
    ix.start[i] = s;
    ix.byId.set(w[0], i);
    for (let j = 4; j < w.length; j += 4, s++) {
      const lab = [w[j], w[j + 1], w[j + 2]];
      const f = swatchFeatures(lab, file.curve);
      ix.hue[s] = f.hue;
      ix.vivid[s] = f.vivid;
      ix.weight[s] = w[j + 3] / 100;
      ix.rgb.set(labToRgb(lab[0], lab[1] * DISPLAY_CHROMA, lab[2] * DISPLAY_CHROMA), s * 3);
    }
  });
  ix.start[n] = s;
  return (loaded = ix);
}

function score(ix: Index, i: number, hue: number) {
  let total = accentScore(ix.accent[i], hue);
  for (let s = ix.start[i]; s < ix.start[i + 1]; s++) {
    if (ix.vivid[s] === 0) continue;
    const d = hueDistance(ix.hue[s], hue);
    if (d < MATCH.tolerance) total += ix.weight[s] * (1 - d / MATCH.tolerance) * ix.vivid[s];
  }
  return total;
}

function typeFilter(type: TypeKey): Set<number> | null {
  const ids = TYPES.find((t) => t.key === type)?.ids;
  return ids ? new Set(ids) : null;
}

/** Score of a work for one or two hues: with two, it's the weaker of the two, so both must be present. */
function matchScore(ix: Index, i: number, hues: number[]) {
  let m = Infinity;
  for (const h of hues) m = Math.min(m, score(ix, i, h));
  return m;
}

const thresholdFor = (hues: number[]) => (hues.length > 1 ? PAIR_THRESHOLD : MATCH.threshold);

// Small LRU: Map iteration order is insertion order.
const cache = new Map<string, unknown>();
function memo<T>(key: string, compute: () => T): T {
  if (cache.has(key)) {
    const v = cache.get(key) as T;
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const v = compute();
  cache.set(key, v);
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return v;
}

/** All matching work ids, best first. */
export function rankedIds(hues: number[], type: TypeKey): Int32Array {
  return memo(`rank|${type}|${hues.join(",")}`, () => {
    const ix = index();
    const allowed = typeFilter(type);
    const min = thresholdFor(hues);
    const hits: { id: number; rank: number }[] = [];
    for (let i = 0; i < ix.ids.length; i++) {
      if (allowed && !allowed.has(ix.types[i])) continue;
      const s = matchScore(ix, i, hues);
      if (s >= min) hits.push({ id: ix.ids[i], rank: s * (ix.boosted[i] ? BOOST : 1) });
    }
    hits.sort((a, b) => b.rank - a.rank);
    return Int32Array.from(hits, (h) => h.id);
  });
}

/**
 * Works matching each wheel bucket (bucket b = hue b·5°). With `withHue`,
 * counts works that contain both that hue and the bucket's: the ring then
 * shows which pairings actually exist in the collection.
 */
export function histogram(type: TypeKey, withHue?: number): number[] {
  return memo(`hist|${type}|${withHue ?? ""}`, () => {
    const ix = index();
    const allowed = typeFilter(type);
    const min = withHue === undefined ? MATCH.threshold : PAIR_THRESHOLD;
    const out = new Array(BUCKETS).fill(0);
    const scores = new Float32Array(BUCKETS);
    for (let i = 0; i < ix.ids.length; i++) {
      if (allowed && !allowed.has(ix.types[i])) continue;
      if (withHue !== undefined && score(ix, i, withHue) < min) continue;
      // Each swatch only reaches the few buckets within the tolerance, so
      // fill those directly instead of scoring all 72 hues.
      scores.fill(0);
      if (ix.accent[i] >= 0) {
        for (let k = Math.ceil((ix.accent[i] - MATCH.accentWindow) / HISTOGRAM_STEP); k * HISTOGRAM_STEP <= ix.accent[i] + MATCH.accentWindow; k++) {
          scores[((k % BUCKETS) + BUCKETS) % BUCKETS] += accentScore(ix.accent[i], k * HISTOGRAM_STEP);
        }
      }
      for (let s = ix.start[i]; s < ix.start[i + 1]; s++) {
        if (ix.vivid[s] === 0) continue;
        const first = Math.ceil((ix.hue[s] - MATCH.tolerance) / HISTOGRAM_STEP);
        const last = Math.floor((ix.hue[s] + MATCH.tolerance) / HISTOGRAM_STEP);
        for (let k = first; k <= last; k++) {
          const d = hueDistance(ix.hue[s], k * HISTOGRAM_STEP);
          if (d < MATCH.tolerance) scores[((k % BUCKETS) + BUCKETS) % BUCKETS] += ix.weight[s] * (1 - d / MATCH.tolerance) * ix.vivid[s];
        }
      }
      for (let b = 0; b < BUCKETS; b++) if (scores[b] >= min) out[b]++;
    }
    return out;
  });
}

export type PaletteSwatch = { rgb: [number, number, number]; weight: number; hue: number; vivid: boolean };

/** A work's palette for display, largest share first. */
export function paletteOf(id: number): PaletteSwatch[] {
  const ix = index();
  const i = ix.byId.get(id);
  if (i === undefined) return [];
  const out: PaletteSwatch[] = [];
  for (let s = ix.start[i]; s < ix.start[i + 1]; s++) {
    out.push({
      rgb: [ix.rgb[s * 3], ix.rgb[s * 3 + 1], ix.rgb[s * 3 + 2]],
      weight: Math.round(ix.weight[s] * 100),
      hue: Math.round(ix.hue[s]),
      vivid: ix.vivid[s] > 0,
    });
  }
  return out;
}

export const indexSize = () => index().ids.length;
