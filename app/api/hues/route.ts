import { isTypeKey } from "@/lib/catalog";
import { parseHues } from "@/lib/color";
import { histogram } from "@/lib/palette-index";

/** Works per wheel hue; with `with=<hue>`, works containing both that hue and each bucket's. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const type = p.get("type") ?? "all";
  const withHue = p.has("with") ? parseHues(p.get("with"), [])[0] : undefined;
  if (!isTypeKey(type) || (p.has("with") && withHue === undefined)) {
    return Response.json({ error: "bad params" }, { status: 400 });
  }
  return Response.json(histogram(type, withHue), {
    // The index only changes on deploy.
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
  });
}
