// Art Institute of Chicago API client. Color matching happens in our own index
// (lib/palette-index.ts); the API supplies titles, artists and image ids for
// just the works on screen: one request per page of 30, and never for the same
// work twice while it's in the cache.

import { paletteOf, type PaletteSwatch } from "./palette-index";

const API = "https://api.artic.edu/api/v1";
const HEADERS = { "AIC-User-Agent": "Chromatic (personal art explorer)" };
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 5000;

export type Artwork = {
  id: number;
  title: string;
  artist: string | null;
  artistDisplay: string | null;
  date: string | null;
  medium: string | null;
  dimensions: string | null;
  origin: string | null;
  type: string | null;
  imageId: string;
  width: number;
  height: number;
  lqip: string | null;
  alt: string | null;
  palette: PaletteSwatch[];
  /** The work's most prominent vivid color, for glows. */
  accent: [number, number, number];
};

export type SearchResult = { total: number; page: number; hasMore: boolean; items: Artwork[] };

const FIELDS = [
  "id", "title", "artist_title", "artist_display", "date_display", "medium_display", "dimensions",
  "place_of_origin", "artwork_type_title", "image_id", "thumbnail",
];

type Raw = {
  id: number;
  title: string;
  artist_title: string | null;
  artist_display: string | null;
  date_display: string | null;
  medium_display: string | null;
  dimensions: string | null;
  place_of_origin: string | null;
  artwork_type_title: string | null;
  image_id: string | null;
  thumbnail: { lqip?: string; width?: number; height?: number; alt_text?: string } | null;
};

function accentOf(palette: PaletteSwatch[]): [number, number, number] {
  const vivid = palette.filter((s) => s.vivid);
  const pick = (vivid.length ? vivid : palette).reduce((a, b) => (b.weight > a.weight ? b : a), palette[0]);
  return pick?.rgb ?? [128, 128, 128];
}

function toArtwork(r: Raw & { image_id: string }): Artwork {
  const palette = paletteOf(r.id);
  return {
    id: r.id,
    title: r.title,
    artist: r.artist_title,
    artistDisplay: r.artist_display,
    date: r.date_display,
    medium: r.medium_display,
    dimensions: r.dimensions,
    origin: r.place_of_origin,
    type: r.artwork_type_title,
    imageId: r.image_id,
    width: r.thumbnail?.width || 4,
    height: r.thumbnail?.height || 3,
    lqip: r.thumbnail?.lqip ?? null,
    alt: r.thumbnail?.alt_text ?? null,
    palette,
    accent: accentOf(palette),
  };
}

const cache = new Map<number, { at: number; art: Artwork | null }>();

/** Details for these works, in the order given. Works that vanished from the API are dropped. */
export async function getArtworks(ids: number[]): Promise<Artwork[]> {
  const now = Date.now();
  const missing = ids.filter((id) => {
    const hit = cache.get(id);
    return !hit || now - hit.at > TTL_MS;
  });

  if (missing.length) {
    const url = `${API}/artworks?ids=${missing.join(",")}&limit=${missing.length}&fields=${FIELDS.join(",")}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) throw new Error(`AIC ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { data } = (await res.json()) as { data: Raw[] };
    const found = new Map(data.map((r) => [r.id, r]));
    for (const id of missing) {
      const r = found.get(id);
      // Remember misses too, so a removed work doesn't trigger a request every page view.
      cache.set(id, { at: now, art: r?.image_id ? toArtwork(r as Raw & { image_id: string }) : null });
    }
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }

  return ids.map((id) => cache.get(id)?.art).filter((a): a is Artwork => Boolean(a));
}
