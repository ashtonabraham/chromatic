// One-time crawl of every public-domain work with an image, saving the bits
// the palette index needs. Run: npm run crawl
//
// - Keyset pagination (id > last id seen, sorted by id) instead of page
//   numbers: the API caps page-number paging at 10,000 results, keysets don't.
// - Resumable: rerunning picks up after the last saved id.
// - Polite: one request per second, the museum's published guideline.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const OUT = "data/raw/works.jsonl";
const API = "https://api.artic.edu/api/v1/artworks/search";
const HEADERS = { "AIC-User-Agent": "Chromatic (personal art explorer)" };
const PAGE = 100; // the API's maximum
const DELAY_MS = 1000;
const EXCLUDED_TYPES = [11, 34, 43, 45, 46, 47, 49];

type Raw = {
  id: number;
  artwork_type_id: number | null;
  is_boosted: boolean;
  thumbnail: { lqip?: string; width?: number; height?: number } | null;
  color: { h: number; s: number; l: number; percentage: number } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastSavedId(): number {
  if (!existsSync(OUT)) return 0;
  const lines = readFileSync(OUT, "utf8").trimEnd().split("\n");
  return lines[0] ? JSON.parse(lines.at(-1)!).id : 0;
}

async function page(after: number, attempt = 0): Promise<{ total: number; data: Raw[] }> {
  const body = {
    query: {
      bool: {
        must: [{ term: { is_public_domain: true } }, { exists: { field: "image_id" } }, { range: { id: { gt: after } } }],
        must_not: [{ terms: { artwork_type_id: EXCLUDED_TYPES } }],
      },
    },
    sort: [{ id: "asc" }],
    fields: ["id", "artwork_type_id", "is_boosted", "thumbnail", "color"],
    limit: PAGE,
  };
  const res = await fetch(`${API}?params=${encodeURIComponent(JSON.stringify(body))}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => e);
  if (res instanceof Error || !res.ok) {
    if (attempt >= 5) throw res instanceof Error ? res : new Error(`HTTP ${res.status}`);
    const wait = 2000 * 2 ** attempt;
    console.warn(`  retry in ${wait / 1000}s (${res instanceof Error ? res.message : res.status})`);
    await sleep(wait);
    return page(after, attempt + 1);
  }
  const json = await res.json();
  return { total: json.pagination.total, data: json.data };
}

mkdirSync("data/raw", { recursive: true });
let after = lastSavedId();
let saved = 0;
const started = Date.now();
if (after) console.log(`Resuming after id ${after}`);

for (;;) {
  const { total, data } = await page(after);
  if (data.length === 0) break;
  appendFileSync(
    OUT,
    data
      .map((w) =>
        JSON.stringify({
          id: w.id,
          type: w.artwork_type_id,
          boosted: w.is_boosted ? 1 : 0,
          lqip: w.thumbnail?.lqip ?? null,
          w: w.thumbnail?.width ?? null,
          h: w.thumbnail?.height ?? null,
          aic: w.color ? [w.color.h, w.color.s, w.color.l, +w.color.percentage.toFixed(4)] : null,
        }),
      )
      .join("\n") + "\n",
  );
  saved += data.length;
  after = data.at(-1)!.id;
  // `total` counts what's left after the cursor, so this is the remaining work.
  const rate = saved / ((Date.now() - started) / 1000);
  console.log(`+${data.length} (through id ${after}) · ${total - data.length} left · ~${Math.round((total - data.length) / rate / 60)} min`);
  await sleep(DELAY_MS);
}

console.log(`Done: ${saved} works saved this run → ${OUT}`);
