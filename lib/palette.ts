// Palette extraction and color matching, in CIELAB: a color space where equal
// distances look equally different to people, unlike RGB or HSL. Shared by the
// index builder (scripts/) and the server-side search.

/** [L, a, b, weight%]: one palette color and how much of the image it covers. */
export type Swatch = [number, number, number, number];

// ---- conversions ------------------------------------------------------------

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  // sRGB → XYZ (D65), normalized by the reference white.
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t > 6 / 29 ? t ** 3 : (108 / 841) * (t - 4 / 29));
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const R = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const G = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const B = 0.0557 * x - 0.204 * y + 1.057 * z;
  const gam = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };
  return [gam(R), gam(G), gam(B)];
}

/** Chroma: colorfulness of a Lab color (0 = grey). */
export const chroma = (a: number, b: number) => Math.hypot(a, b);

const dist2 = (p: number[], q: number[]) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

// ---- extraction ---------------------------------------------------------------

/**
 * Up to `k` representative colors from RGBA pixels, via k-means in Lab. The
 * input here is the museum's tiny blurred preview (5px tall), so there are only
 * ~15–40 pixels, which makes this cheap enough to run on 58k works in seconds.
 * Initialization is deterministic (farthest point), so rebuilding the index
 * gives identical palettes.
 */
export function extractPalette(rgba: Uint8Array | Uint8ClampedArray, k = 5): Swatch[] {
  const px: number[][] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    px.push(rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]));
  }
  if (px.length === 0) return [];

  const mean = [0, 1, 2].map((d) => px.reduce((s, p) => s + p[d], 0) / px.length);
  let first = px[0];
  for (const p of px) if (dist2(p, mean) < dist2(first, mean)) first = p;
  const centers = [first.slice()];
  while (centers.length < Math.min(k, px.length)) {
    let far = px[0], farD = -1;
    for (const p of px) {
      const d = Math.min(...centers.map((c) => dist2(p, c)));
      if (d > farD) (far = p), (farD = d);
    }
    if (farD < 1) break; // the rest are duplicates
    centers.push(far.slice());
  }

  let assign = new Array(px.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const next = px.map((p) => {
      let best = 0;
      for (let c = 1; c < centers.length; c++) if (dist2(p, centers[c]) < dist2(p, centers[best])) best = c;
      return best;
    });
    const stable = next.every((v, i) => v === assign[i]);
    assign = next;
    for (let c = 0; c < centers.length; c++) {
      const members = px.filter((_, i) => assign[i] === c);
      if (members.length) centers[c] = [0, 1, 2].map((d) => members.reduce((s, p) => s + p[d], 0) / members.length);
    }
    if (stable && iter > 0) break;
  }

  // Merge near-identical clusters (ΔE < 8 is "the same color" for our purposes).
  const clusters = centers.map((c, i) => ({ c, n: assign.filter((a) => a === i).length })).filter((x) => x.n > 0);
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (dist2(clusters[i].c, clusters[j].c) < 64) {
        const n = clusters[i].n + clusters[j].n;
        clusters[i].c = [0, 1, 2].map((d) => (clusters[i].c[d] * clusters[i].n + clusters[j].c[d] * clusters[j].n) / n);
        clusters[i].n = n;
        clusters.splice(j--, 1);
      }
    }
  }

  return clusters
    .sort((x, y) => y.n - x.n)
    .map(({ c, n }) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round((n / px.length) * 100)]);
}

// ---- matching -----------------------------------------------------------------
//
// Hue comparisons happen in wheel (HSL) degrees, so a tolerance means the same
// thing all the way round the wheel people are dragging. Lab hue is uneven
// there: a fixed Lab window covers a wide band of greens but a sliver of blues.
// Colorfulness, on the other hand, comes from Lab chroma, because HSL
// saturation calls near-black and near-white colors "saturated".

/** Tuning knobs, exported so the build script can report what it used. */
export const MATCH = {
  // Below this chroma a swatch is grey whatever its hue angle says.
  absMinChroma: 5,
  // Colorfulness is judged against the collection, per hue: a swatch starts
  // counting above the floorQuantile chroma of swatches at its hue and counts
  // fully at fullQuantile. Absolute cutoffs fail here because the collection
  // (and its blurred previews) is muted unevenly: typical warm swatches sit
  // at chroma 12–16, cool ones at 7–10, and aged paper reads as faint yellow.
  floorQuantile: 0.6,
  fullQuantile: 0.97,
  // How far (wheel degrees) a swatch's hue can be from the target and count.
  tolerance: 18,
  // Minimum score for a work to count as "in" a color.
  threshold: 0.1,
  // The museum's own "dominant color" is computed from the full image but is
  // usually a small accent (median ~1.7% of the image). It's worth exactly the
  // threshold: enough to include the work, never enough to outrank a work
  // where the color covers real area.
  accent: 0.1,
  accentWindow: 12,
};

const BANDS = 36; // 10° each

/** Per-band chroma floor/full, measured from the collection at build time. */
export type VividCurve = { floor: number[]; full: number[] };

function rgbHue(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export const labWheelHue = ([L, a, b]: Swatch | number[]) => rgbHue(...labToRgb(L, a, b));

/** Area-weighted chroma quantiles per 10° band, smoothed over ±20° so sparse bands stay stable. */
export function buildVividCurve(swatches: { hue: number; chroma: number; weight: number }[]): VividCurve {
  const bands: { c: number; w: number }[][] = Array.from({ length: BANDS }, () => []);
  for (const s of swatches) if (s.chroma >= MATCH.absMinChroma) bands[Math.floor(s.hue / 10) % BANDS].push({ c: s.chroma, w: s.weight });
  const quantile = (pool: { c: number; w: number }[], q: number) => {
    const total = pool.reduce((t, p) => t + p.w, 0);
    let acc = 0;
    for (const p of pool) if ((acc += p.w) >= q * total) return Math.round(p.c * 10) / 10;
    return pool.at(-1)?.c ?? 0;
  };
  const floor: number[] = [], full: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    const pool = [-2, -1, 0, 1, 2].flatMap((d) => bands[(b + d + BANDS) % BANDS]).sort((x, y) => x.c - y.c);
    floor.push(Math.max(MATCH.absMinChroma, quantile(pool, MATCH.floorQuantile)));
    full.push(Math.max(floor[b] + 3, quantile(pool, MATCH.fullQuantile)));
  }
  return { floor, full };
}

/** A swatch's position on the wheel and how much it counts (0 = grey/typical, 1 = vivid for its hue). */
export function swatchFeatures(lab: Swatch | number[], curve: VividCurve): { hue: number; vivid: number } {
  const hue = labWheelHue(lab);
  const C = chroma(lab[1], lab[2]);
  const b = Math.floor(hue / 10) % BANDS;
  const vivid = C < MATCH.absMinChroma ? 0 : Math.max(0, Math.min(1, (C - curve.floor[b]) / (curve.full[b] - curve.floor[b])));
  return { hue, vivid };
}

export const hueDistance = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);

/** Contribution of the museum's accent color (wheel hue, or -1 for none). */
export const accentScore = (accentHue: number, wheelHue: number) =>
  accentHue >= 0 && hueDistance(accentHue, wheelHue) <= MATCH.accentWindow ? MATCH.accent : 0;

/**
 * How strongly a palette contains a wheel hue: the share of the image near
 * that hue, scaled by how vivid it is. 0.25 ≈ a quarter of the work is
 * clearly that color.
 */
export function hueScore(features: { hue: number; vivid: number; weight: number }[], wheelHue: number, accentHue = -1): number {
  let s = accentScore(accentHue, wheelHue);
  for (const f of features) {
    if (f.vivid === 0) continue;
    const d = hueDistance(f.hue, wheelHue);
    if (d < MATCH.tolerance) s += f.weight * (1 - d / MATCH.tolerance) * f.vivid;
  }
  return s;
}
