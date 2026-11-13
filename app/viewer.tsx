"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/aic";
import { glowColor, hueName, imageUrl } from "@/lib/color";
import { hueDistance } from "@/lib/palette";

type Props = {
  items: Artwork[];
  index: number;
  /** Where the clicked card was, so the image can grow out of it. */
  origin: DOMRect | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  /** Search for one color, or a pair. */
  onExploreHues: (hues: number[]) => void;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Viewer({ items, index, origin, onClose, onNavigate, onExploreHues }: Props) {
  const art = items[index];
  const overlay = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [hiResLoaded, setHiResLoaded] = useState<number | null>(null);
  // The work that was clicked grows from its card; ones arrowed to fade in.
  const openedId = useRef(art.id);

  const close = () => {
    if (reducedMotion()) return onClose();
    overlay.current!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in" }).onfinish = onClose;
  };

  // Grow from the card (FLIP: measure the final box, then animate from the
  // card's box back to it). Card and frame share an aspect ratio.
  useLayoutEffect(() => {
    if (!origin || reducedMotion()) return;
    const to = frame.current!.getBoundingClientRect();
    frame.current!.animate(
      [
        { transformOrigin: "top left", transform: `translate(${origin.left - to.left}px, ${origin.top - to.top}px) scale(${origin.width / to.width})` },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 560, easing: "cubic-bezier(0.2, 0.75, 0.15, 1)" },
    );
    // Only on open; navigating between works crossfades instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus, scroll lock, and returning focus to wherever it was on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && index < items.length - 1) onNavigate(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
    };
    window.addEventListener("keydown", onKey);
    // Warm the neighbors so arrowing through is instant.
    for (const n of [items[index - 1], items[index + 1]]) {
      if (!n) continue;
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = imageUrl(n);
    }
    return () => window.removeEventListener("keydown", onKey);
  });

  const ratio = art.width / art.height;
  const facts = [
    ["Date", art.date],
    ["Medium", art.medium],
    ["Dimensions", art.dimensions],
    ["Origin", art.origin],
    ["Type", art.type],
  ].filter((f): f is [string, string] => Boolean(f[1]));

  // The two strongest vivid colors that are actually different hues.
  const vivid = art.palette.filter((s) => s.vivid).sort((a, b) => b.weight - a.weight);
  const partner = vivid.find((s) => hueDistance(s.hue, vivid[0]?.hue ?? 0) >= 45);
  const pairing = vivid[0] && partner ? [vivid[0].hue, partner.hue] : null;

  return (
    <div
      ref={overlay}
      role="dialog"
      aria-modal="true"
      aria-label={art.title}
      className="fixed inset-0 z-50 overflow-y-auto bg-[#060607]/90 backdrop-blur-2xl md:overflow-hidden"
      style={{ backgroundImage: `radial-gradient(900px 600px at 35% 45%, ${glowColor(art.accent, 0.22)}, transparent 70%)` }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex min-h-full flex-col md:grid md:h-full md:grid-cols-[1fr_380px]">
        <div
          className="flex items-center justify-center p-5 pt-16 [--avail:58dvh] md:p-10 md:[--avail:calc(100dvh-5rem)]"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div
            ref={frame}
            key={art.id}
            className={`relative overflow-hidden rounded-sm ${origin && art.id === openedId.current ? "" : "fade-in"}`}
            style={{
              aspectRatio: `${art.width} / ${art.height}`,
              width: `min(100%, calc(var(--avail) * ${ratio}))`,
              boxShadow: `0 40px 140px -30px ${glowColor(art.accent, 0.7)}`,
            }}
          >
            {art.lqip && <div aria-hidden className="absolute inset-0 scale-110 bg-cover blur-xl" style={{ backgroundImage: `url(${art.lqip})` }} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(art)} alt={art.alt ?? art.title} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = "hidden")} className="absolute inset-0 h-full w-full object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(art, 1686)}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              onLoad={() => setHiResLoaded(art.id)}
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
              style={{ opacity: hiResLoaded === art.id ? 1 : 0 }}
            />
          </div>
        </div>

        <aside key={art.id} className="fade-in flex flex-col gap-6 border-white/10 px-6 pb-10 md:overflow-y-auto md:border-l md:bg-black/25 md:px-8 md:py-10">
          <div className="hidden items-center justify-between md:flex md:pr-14">
            <Nav index={index} total={items.length} onNavigate={onNavigate} />
          </div>

          <div>
            <h2 className="font-serif text-3xl leading-tight text-balance">{art.title}</h2>
            {art.artistDisplay && <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-white/60">{art.artistDisplay}</p>}
          </div>

          <dl className="space-y-3 text-sm">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] tracking-[0.14em] text-white/35 uppercase">{k}</dt>
                <dd className="mt-0.5 text-white/80">{v}</dd>
              </div>
            ))}
          </dl>

          {art.palette.length > 0 && (
            <section aria-label="Palette" className="space-y-3">
              <h3 className="text-[11px] tracking-[0.14em] text-white/35 uppercase">Palette</h3>
              {/* Each color's width is its share of the work. Vivid ones
                  are searchable; greys and browns are shown but inert. */}
              <div className="flex h-11 overflow-hidden rounded-md ring-1 ring-white/10">
                {art.palette.map((s, i) => {
                  const bg = `rgb(${s.rgb.join(" ")})`;
                  return s.vivid ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onExploreHues([s.hue])}
                      title={`Search ${hueName(s.hue).toLowerCase()} · ${s.weight}% of this work`}
                      aria-label={`Search ${hueName(s.hue).toLowerCase()}, ${s.weight}% of this work`}
                      className="relative min-w-3 transition-[flex-grow] duration-300 outline-none hover:grow-[1.4] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white"
                      style={{ flexGrow: s.weight, backgroundColor: bg }}
                    />
                  ) : (
                    <span key={i} className="min-w-3" style={{ flexGrow: s.weight, backgroundColor: bg }} />
                  );
                })}
              </div>
              {vivid.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pairing && (
                    <button
                      type="button"
                      onClick={() => onExploreHues(pairing)}
                      className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm ring-1 ring-white/20 transition hover:bg-white/5 hover:ring-white/40"
                    >
                      <span className="flex -space-x-1.5">
                        {pairing.map((h) => (
                          <span key={h} className="size-5 rounded-full ring-2 ring-black/50" style={{ backgroundColor: `hsl(${h} 65% 50%)` }} />
                        ))}
                      </span>
                      More {pairing.map((h) => hueName(h).toLowerCase()).join(" & ")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onExploreHues([vivid[0].hue])}
                    className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm ring-1 ring-white/20 transition hover:bg-white/5 hover:ring-white/40"
                  >
                    <span className="size-5 rounded-full" style={{ backgroundColor: `hsl(${vivid[0].hue} 65% 50%)` }} />
                    More {hueName(vivid[0].hue).toLowerCase()}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-white/40">A muted palette: no single color stands out.</p>
              )}
            </section>
          )}

          <a
            href={`https://www.artic.edu/artworks/${art.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white/80"
          >
            View at the Art Institute of Chicago ↗
          </a>

          <div className="mt-auto flex items-center justify-between md:hidden">
            <Nav index={index} total={items.length} onNavigate={onNavigate} />
          </div>
        </aside>
      </div>

      <button
        ref={closeBtn}
        type="button"
        onClick={close}
        aria-label="Close"
        className="fixed top-4 right-4 grid size-10 place-items-center rounded-full bg-black/50 text-xl text-white/80 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/70 hover:text-white md:top-[30px] md:right-8"
      >
        ×
      </button>
    </div>
  );
}

function Nav({ index, total, onNavigate }: { index: number; total: number; onNavigate: (i: number) => void }) {
  const btn = "grid size-9 place-items-center rounded-full ring-1 ring-white/15 transition hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <>
      <span className="text-xs text-white/40 tabular-nums">
        {index + 1} / {total}
      </span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={index === 0} onClick={() => onNavigate(index - 1)} aria-label="Previous work">
          ←
        </button>
        <button type="button" className={btn} disabled={index === total - 1} onClick={() => onNavigate(index + 1)} aria-label="Next work">
          →
        </button>
      </div>
    </>
  );
}
