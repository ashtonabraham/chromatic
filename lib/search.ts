import { getArtworks, type SearchResult } from "./aic";
import type { TypeKey } from "./catalog";
import { rankedIds } from "./palette-index";

export const PAGE_SIZE = 30;

/** One page of works containing all of `hues` (one color, or a pair). */
export async function search(hues: number[], type: TypeKey, page: number): Promise<SearchResult> {
  const ranked = rankedIds(hues, type);
  const ids = Array.from(ranked.subarray((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  return {
    total: ranked.length,
    page,
    hasMore: page * PAGE_SIZE < ranked.length,
    items: await getArtworks(ids),
  };
}
