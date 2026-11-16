// Shared between server and client, so no server-only imports here.

export const IIIF = "https://www.artic.edu/iiif/2";
export const HISTOGRAM_STEP = 5;

/**
 * 843px is the width the museum's image server keeps pre-cached. It refuses
 * (403) to upscale, so small originals are requested at their own width.
 */
export const imageUrl = (art: { imageId: string; width: number }, width: 843 | 1686 = 843) =>
  `${IIIF}/${art.imageId}/full/${Math.min(width, art.width)},/0/default.jpg`;

// The largest image the museum serves publicly: 3000px on the longest side.
const MAX_DOWNLOAD = 3000;

/**
 * Download sources, best first. The image server's rules are undocumented and
 * uneven: it refuses some size syntaxes for the same output (`,3000` works
 * where the identical `1569,` doesn't) and sometimes redirects to a smaller
 * cached size (asking for 1686 can return 843). So the caller should check
 * what it actually got against downloadSize() and fall through.
 */
export function downloadUrls(art: { imageId: string; width: number; height: number }) {
  const base = `${IIIF}/${art.imageId}/full`;
  const fit = `${base}/!${MAX_DOWNLOAD},${MAX_DOWNLOAD}/0/default.jpg`;
  // Originals within the limit: asking for their exact width returns them as-is.
  const original = `${base}/${art.width},/0/default.jpg`;
  const urls = Math.max(art.width, art.height) <= MAX_DOWNLOAD ? [original, fit] : [fit];
  return [...urls, imageUrl(art, 1686), imageUrl(art)];
}

/** Pixel size of the best download, for labeling the button. */
export function downloadSize(art: { width: number; height: number }) {
  const scale = Math.min(1, MAX_DOWNLOAD / Math.max(art.width, art.height));
  return { width: Math.round(art.width * scale), height: Math.round(art.height * scale) };
}

/** Queries snap to 5° so nearby drags share cache entries. */
export const snapHue = (h: number) => (Math.round(h / HISTOGRAM_STEP) * HISTOGRAM_STEP) % 360;

const NAMES: [number, string][] = [
  [8, "Red"], [18, "Vermilion"], [32, "Orange"], [42, "Amber"], [52, "Gold"], [62, "Yellow"],
  [80, "Chartreuse"], [150, "Green"], [172, "Jade"], [192, "Teal"], [205, "Cerulean"],
  [228, "Blue"], [248, "Ultramarine"], [275, "Violet"], [300, "Purple"], [328, "Magenta"],
  [348, "Rose"], [360, "Red"],
];

export const hueName = (h: number) => NAMES.find(([max]) => ((h % 360) + 360) % 360 < max)?.[1] ?? "Red";

/** Works matching this hue, read off the histogram (one bucket per HISTOGRAM_STEP°). */
export const countAt = (histogram: number[], hue: number) =>
  histogram[Math.round(hue / HISTOGRAM_STEP) % histogram.length] ?? 0;

/** "210" or "210,30" from the URL → one or two snapped, distinct hues. */
export function parseHues(param: string | null | undefined, fallback: number[]): number[] {
  const hues = (param ?? "")
    .split(",")
    .slice(0, 2)
    .map(Number)
    .filter((h) => param && Number.isFinite(h))
    .map((h) => snapHue(((h % 360) + 360) % 360));
  const unique = [...new Set(hues)];
  return unique.length ? unique : fallback;
}

/** Glow color from a palette RGB, lifted so dark accents still glow. */
export function glowColor([r, g, b]: [number, number, number], alpha = 0.6) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  const sat = Math.max(s * 100, 40), light = Math.min(Math.max(l * 100, 45), 65);
  return `hsl(${Math.round(h * 60)} ${Math.round(sat)}% ${Math.round(light)}% / ${alpha})`;
}

/** Nearest hues with at least `min` works, for steering people out of empty areas. */
export function nearbyRichHues(histogram: number[], hue: number, min = 40, take = 3) {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let d = 5; d <= 180 && out.length < take; d += 5) {
    for (const h of [hue - d, hue + d]) {
      const hh = ((h % 360) + 360) % 360;
      const name = hueName(hh);
      if (!seen.has(name) && countAt(histogram, hh) >= min && name !== hueName(hue)) {
        seen.add(name);
        out.push(hh);
      }
    }
  }
  return out.slice(0, take);
}

/** Pick the equivalent of `next` closest to `prev`, so 350° → 10° animates 20°, not 340°. */
export function unwrapHue(prev: number, next: number) {
  return prev + ((((next - prev) % 360) + 540) % 360) - 180;
}
