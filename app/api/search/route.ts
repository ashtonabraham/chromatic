import { isTypeKey } from "@/lib/catalog";
import { parseHues } from "@/lib/color";
import { search } from "@/lib/search";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const hues = parseHues(p.get("h"), []);
  const type = p.get("type") ?? "all";
  const page = Math.max(1, Math.floor(Number(p.get("page") ?? 1)));
  if (!hues.length || !isTypeKey(type) || !Number.isFinite(page)) {
    return Response.json({ error: "bad params" }, { status: 400 });
  }
  try {
    return Response.json(await search(hues, type, page), {
      // Browsers reuse for an hour; a CDN for a day while revalidating.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
