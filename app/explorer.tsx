"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artwork, SearchResult } from "@/lib/aic";
import { TYPES, type TypeKey } from "@/lib/catalog";
import { countAt, HISTOGRAM_STEP, hueName, nearbyRichHues, snapHue, unwrapHue } from "@/lib/color";
import { hueDistance } from "@/lib/palette";
import { Gallery } from "./gallery";
import { Viewer } from "./viewer";
import { Wheel } from "./wheel";

type Props = {
  initialHues: number[];
  initialType: TypeKey;
  initialHistogram: number[];
  initial: SearchResult | null;
  collectionSize: number;
};

// `hues` are the colors these items were searched for, which can lag the
// wheel while a new search loads.
type GalleryState = { key: string; hues: number[]; items: Artwork[]; total: number; page: number; hasMore: boolean };
type Status = "idle" | "switching" | "more" | "error";

// A second color must be at least this far from the first to be worth pairing.
const MIN_PAIR_GAP = 45;

// Pages and rings already fetched this session: going back is instant.
const pageCache = new Map<string, SearchResult>();
const ringCache = new Map<string, Promise<number[]>>();

async function fetchPage(hues: number[], type: TypeKey, page: number, signal?: AbortSignal) {
  const key = `${type}|${hues.join(",")}|${page}`;
  const hit = pageCache.get(key);
  if (hit) return hit;
  const res = await fetch(`/api/search?h=${hues.join(",")}&type=${type}&page=${page}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data: SearchResult = await res.json();
  pageCache.set(key, data);
  return data;
}

/** The ring depends only on the type and the color that isn't being moved. */
const ringKey = (type: TypeKey, hues: number[], active: number) => `${type}|${hues.length > 1 ? hues[1 - active] : ""}`;

function fetchRing(type: TypeKey, withHue?: number) {
  const key = `${type}|${withHue ?? ""}`;
  if (!ringCache.has(key)) {
    const p = fetch(`/api/hues?type=${type}${withHue === undefined ? "" : `&with=${withHue}`}`).then((r) => {
      if (!r.ok) throw new Error(`hues ${r.status}`);
      return r.json() as Promise<number[]>;
    });
    p.catch(() => ringCache.delete(key));
    ringCache.set(key, p);
  }
  return ringCache.get(key)!;
}

/** Hues (one per color name) with the most works alongside `fixed`. */
function bestPartners(ring: number[], fixed: number, take = 3) {
  const names = new Set([hueName(fixed)]);
  return ring
    .map((n, b) => ({ hue: b * HISTOGRAM_STEP, n }))
    .filter((x) => x.n > 0 && hueDistance(x.hue, fixed) >= MIN_PAIR_GAP)
    .sort((a, b) => b.n - a.n)
    .filter((x) => !names.has(hueName(x.hue)) && names.add(hueName(x.hue)))
    .slice(0, take)
    .map((x) => x.hue);
}

const keyOf = (type: TypeKey, hues: number[]) => `${type}|${hues.join(",")}`;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((h, i) => h === b[i]);

export function Explorer({ initialHues, initialType, initialHistogram, initial, collectionSize }: Props) {
  const [previews, setPreviews] = useState(initialHues);
  const [hues, setHues] = useState(initialHues);
  const [active, setActive] = useState(initialHues.length - 1);
  const [type, setType] = useState(initialType);
  const [rings, setRings] = useState<Record<string, number[]>>({
    [ringKey(initialType, initialHues, initialHues.length - 1)]: initialHistogram,
  });
  const [gallery, setGallery] = useState<GalleryState>(() => ({
    key: initial ? keyOf(initialType, initialHues) : "",
    hues: initialHues,
    items: initial?.items ?? [],
    total: initial?.total ?? 0,
    page: initial ? 1 : 0,
    hasMore: initial?.hasMore ?? false,
  }));
  const [status, setStatus] = useState<Status>(initial ? "idle" : "error");
  const [viewer, setViewer] = useState<{ index: number; origin: DOMRect | null } | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);

  const keyRef = useRef(gallery.key);
  const controller = useRef<AbortController | null>(null);
  const tint = useRef({ a: initialHues[0], b: initialHues[1] ?? initialHues[0] + 32 });
  const pendingHues = useRef<number[] | null>(null);
  const hero = useRef<HTMLElement>(null);

  const pair = previews.length > 1;
  const currentRingKey = ringKey(type, previews, active);
  // Until a pair's ring arrives, show the single-color ring rather than nothing.
  const histogram = rings[currentRingKey] ?? rings[`${type}|`] ?? initialHistogram;

  useEffect(() => {
    if (rings[currentRingKey]) return;
    const fixed = previews.length > 1 ? previews[1 - active] : undefined;
    fetchRing(type, fixed).then(
      (r) => setRings((prev) => ({ ...prev, [currentRingKey]: r })),
      () => {},
    );
  }, [currentRingKey, rings, type, previews, active]);

  // Re-tint the page; a pair tints two corners. Hues are unwrapped so
  // 350° → 10° travels the short way.
  useEffect(() => {
    tint.current.a = unwrapHue(tint.current.a, previews[0]);
    tint.current.b = unwrapHue(tint.current.b, pair ? previews[1] : previews[0] + 32);
    document.documentElement.style.setProperty("--hue", String(tint.current.a));
    document.documentElement.style.setProperty("--hue2", String(tint.current.b));
  }, [previews, pair]);

  const load = useCallback(async (h: number[], t: TypeKey, force = false) => {
    const key = keyOf(t, h);
    if (key === keyRef.current && !force) return;
    keyRef.current = key;
    // A newer selection makes any in-flight request pointless.
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setStatus("switching");
    try {
      const r = await fetchPage(h, t, 1, c.signal);
      if (keyRef.current !== key) return;
      setGallery({ key, hues: h, items: r.items, total: r.total, page: 1, hasMore: r.hasMore });
      setStatus("idle");
    } catch {
      if (!c.signal.aborted) setStatus("error");
    }
  }, []);

  const commit = useCallback(
    (next: number[]) => {
      const snapped = next.map(snapHue);
      // Two knobs on the same 5° step would collapse into one color.
      if (snapped.length > 1 && snapped[0] === snapped[1]) snapped[1] = (snapped[1] + HISTOGRAM_STEP) % 360;
      setPreviews(snapped);
      setHues(snapped);
      load(snapped, type);
    },
    [load, type],
  );

  const loadMore = useCallback(async () => {
    if (status !== "idle" || !gallery.hasMore) return;
    const key = gallery.key;
    setStatus("more");
    try {
      const r = await fetchPage(hues, type, gallery.page + 1, controller.current?.signal);
      if (keyRef.current !== key) return;
      setGallery((g) => {
        const seen = new Set(g.items.map((i) => i.id));
        return { ...g, items: [...g.items, ...r.items.filter((i) => !seen.has(i.id))], page: r.page, hasMore: r.hasMore };
      });
      setStatus("idle");
    } catch {
      if (keyRef.current === key) setStatus("error");
    }
  }, [status, gallery, hues, type]);

  const changeType = (t: TypeKey) => {
    setType(t);
    load(hues, t);
  };

  const addSecondColor = async () => {
    const first = hues[0];
    // Default to the color that actually pairs best with this one.
    const ring = await fetchRing(type, first).catch(() => null);
    const partner = (ring && bestPartners(ring, first, 1)[0]) ?? (first + 180) % 360;
    setActive(1);
    commit([first, partner]);
  };

  const removeColor = (i: number) => {
    setActive(0);
    commit(hues.filter((_, j) => j !== i));
  };

  // Keep the URL shareable without adding history entries per drag.
  useEffect(() => {
    if (viewer) return;
    // Built by hand so the pair reads as ?h=210,40 rather than ?h=210%2C40.
    history.replaceState(history.state, "", `?h=${hues.join(",")}${type === "all" ? "" : `&type=${type}`}`);
  }, [hues, type, viewer]);

  // The viewer owns a history entry, so the back button (or swipe) closes it.
  const openViewer = (index: number, from: HTMLElement) => {
    setViewer({ index, origin: from.getBoundingClientRect() });
    history.pushState({ viewer: true }, "");
  };
  useEffect(() => {
    // The page can't scroll while the viewer is open, so there's nothing for
    // the browser to restore on back, and its restoring would undo our
    // scroll-to-top when a viewer link switches colors.
    history.scrollRestoration = "manual";
    const onPop = () => {
      setViewer(null);
      const next = pendingHues.current;
      if (next) {
        pendingHues.current = null;
        setActive(next.length - 1);
        commit(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [commit]);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: "-120px 0px 0px 0px" });
    io.observe(hero.current!);
    return () => io.disconnect();
  }, []);

  const settled = same(previews.map(snapHue), hues) && status !== "switching" && status !== "error";
  const activeHue = previews[active];
  const sparse = countAt(histogram, activeHue) < (pair ? 8 : 30);
  const suggestions = pair ? bestPartners(histogram, previews[1 - active]) : nearbyRichHues(histogram, activeHue);
  const names = hues.map(hueName);

  return (
    <main>
      <header className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-6 sm:px-10">
        <a href="/" className="font-serif text-xl tracking-tight italic">
          Chromatic
        </a>
        <p className="hidden text-xs text-white/40 sm:block">Public-domain works from the Art Institute of Chicago</p>
      </header>

      <section
        ref={hero}
        className="mx-auto grid max-w-[1500px] items-center gap-12 px-5 pt-2 pb-16 sm:px-10 lg:grid-cols-[1fr_auto] lg:gap-20 lg:pb-24"
      >
        <div className="order-2 lg:order-1">
          <p className="text-xs tracking-[0.22em] text-white/40 uppercase">Find art by color</p>
          <h1 className="mt-4 font-serif text-[clamp(2.6rem,7vw,5.6rem)] leading-[0.95] tracking-tight">
            Every work
            <br />
            in{" "}
            {previews.map((h, i) => (
              <span key={i}>
                {i > 0 && <span className="text-white/50"> &amp; </span>}
                <em className="transition-colors duration-500" style={{ color: `hsl(${h} 78% 68%)` }}>
                  {hueName(h).toLowerCase()}
                </em>
              </span>
            ))}
            .
          </h1>
          <p className="mt-6 max-w-md leading-relaxed text-white/55">
            {pair
              ? "Works that contain both colors. The bars around the wheel show how often each color appears alongside the other."
              : `Drag the wheel through ${collectionSize.toLocaleString()} works. The bars around it show how much of the collection lives at each color.`}
          </p>

          <div className="mt-8 flex flex-wrap gap-2" role="radiogroup" aria-label="Type of work">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={t.key === type}
                onClick={() => changeType(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                  t.key === type ? "bg-white text-black" : "text-white/60 ring-1 ring-white/15 hover:text-white hover:ring-white/35"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {sparse && suggestions.length > 0 && (
            <div className="fade-in mt-6 max-w-md rounded-lg bg-white/[0.04] p-4 text-sm ring-1 ring-white/10">
              <p className="text-white/60">
                {pair
                  ? `Few works pair ${hueName(previews[1 - active]).toLowerCase()} with ${hueName(activeHue).toLowerCase()}. Colors that pair well with ${hueName(previews[1 - active]).toLowerCase()}:`
                  : `Only ${countAt(histogram, activeHue).toLocaleString()} works here are strongly ${hueName(activeHue).toLowerCase()}. Nearby colors have more:`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => commit(previews.map((x, i) => (i === active ? h : x)))}
                    className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 ring-1 ring-white/15 hover:ring-white/35"
                  >
                    <span className="size-5 rounded-full" style={{ backgroundColor: `hsl(${h} 65% 50%)` }} />
                    {hueName(h)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="order-1 flex flex-col items-center gap-6 lg:order-2">
          <Wheel
            hues={previews}
            active={active}
            histogram={histogram}
            exactCount={settled ? gallery.total : null}
            onActivate={setActive}
            onPreview={setPreviews}
            onCommit={commit}
          />

          <div className="flex flex-wrap justify-center gap-2" aria-label="Colors">
            {previews.map((h, i) => (
              <span
                key={i}
                className={`flex items-center rounded-full text-sm ring-1 transition ${
                  i === active && pair ? "bg-white/10 ring-white/40" : "ring-white/15"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={pair ? i === active : undefined}
                  disabled={!pair}
                  className="flex items-center gap-2 py-1 pr-3 pl-1 disabled:cursor-default"
                >
                  <span className="size-5 rounded-full" style={{ backgroundColor: `hsl(${h} 65% 50%)` }} />
                  {hueName(h)}
                </button>
                {pair && (
                  <button
                    type="button"
                    onClick={() => removeColor(i)}
                    aria-label={`Remove ${hueName(h)}`}
                    className="-ml-1 grid size-7 place-items-center rounded-full text-white/45 hover:text-white"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!pair && (
              <button
                type="button"
                onClick={addSecondColor}
                className="rounded-full border border-dashed border-white/25 px-3.5 py-1 text-sm text-white/60 transition hover:border-white/50 hover:text-white"
              >
                + Pair with a second color
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1500px] px-5 pb-24 sm:px-10">
        <div className="mb-8 flex items-baseline gap-3 border-t border-white/10 pt-6">
          <h2 className="font-serif text-2xl">{names.join(" & ")}</h2>
          <span className="text-sm text-white/40 tabular-nums">
            {status === "switching" ? "Searching…" : `${gallery.total.toLocaleString()} works`}
          </span>
        </div>

        {status === "error" ? (
          <div className="py-20 text-center">
            <p className="font-serif text-xl">The museum&apos;s API didn&apos;t answer.</p>
            <button
              type="button"
              onClick={() => load(hues, type, true)}
              className="mt-4 rounded-full px-4 py-2 text-sm ring-1 ring-white/20 hover:ring-white/40"
            >
              Try again
            </button>
          </div>
        ) : gallery.items.length === 0 && status === "idle" ? (
          <p className="py-20 text-center font-serif text-xl text-white/50">
            Nothing in {names.join(" & ").toLowerCase()} yet. Try a neighbor on the wheel.
          </p>
        ) : (
          <Gallery
            items={gallery.items}
            hues={gallery.hues}
            dimmed={status === "switching"}
            hasMore={gallery.hasMore}
            loadingMore={status === "more"}
            onLoadMore={loadMore}
            onOpen={openViewer}
          />
        )}
      </section>

      {/* Compact color pill once the wheel scrolls away. */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-hidden={heroVisible}
        tabIndex={heroVisible ? -1 : 0}
        className={`fixed top-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/55 py-1.5 pr-4 pl-1.5 text-sm ring-1 ring-white/15 backdrop-blur-xl transition duration-300 ${
          heroVisible ? "pointer-events-none -translate-y-4 opacity-0" : "opacity-100"
        }`}
      >
        <span className="flex -space-x-2">
          {hues.map((h, i) => (
            <span
              key={i}
              className="size-6 rounded-full ring-2 ring-black/60"
              style={{ backgroundColor: `hsl(${h} 65% 50%)`, boxShadow: `0 0 16px hsl(${h} 70% 50% / .6)` }}
            />
          ))}
        </span>
        <span>{names.join(" & ")}</span>
        <span className="text-white/40">Change color ↑</span>
      </button>

      {viewer && gallery.items[viewer.index] && (
        <Viewer
          items={gallery.items}
          index={viewer.index}
          origin={viewer.origin}
          onClose={() => history.back()}
          onNavigate={(index) => {
            setViewer((v) => v && { ...v, index });
            if (index >= gallery.items.length - 3) loadMore();
          }}
          onExploreHues={(next) => {
            pendingHues.current = next;
            history.back();
          }}
        />
      )}
    </main>
  );
}
