import type { SearchResult } from "@/lib/aic";
import { isTypeKey } from "@/lib/catalog";
import { parseHues } from "@/lib/color";
import { histogram, indexSize } from "@/lib/palette-index";
import { search } from "@/lib/search";
import { Explorer } from "./explorer";

export const dynamic = "force-dynamic";

const DEFAULT_HUES = [210];

export default async function Page({ searchParams }: { searchParams: Promise<{ h?: string; type?: string }> }) {
  const sp = await searchParams;
  const hues = parseHues(sp.h, DEFAULT_HUES);
  const type = isTypeKey(sp.type) ? sp.type : "all";

  // Rendered on the server so the first screen arrives with real art in it.
  const initial = await search(hues, type, 1).catch((): SearchResult | null => null);
  // Ring for the color being edited: with a pair, that's the second one,
  // counted against the first.
  const ring = histogram(type, hues.length > 1 ? hues[0] : undefined);

  return (
    <Explorer
      initialHues={hues}
      initialType={type}
      initialHistogram={ring}
      initial={initial}
      collectionSize={indexSize()}
    />
  );
}
