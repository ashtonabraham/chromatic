"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Artwork } from "@/lib/aic";
import { imageUrl } from "@/lib/color";

// Rough caption height relative to column width, so balancing accounts for it.
const CAPTION = 0.16;

/** The searched color(s) as a CSS background: solid for one, a diagonal gradient for a pair. */
function searchPaint(hues: number[]) {
  const [a, b] = hues.map((h) => `hsl(${h} 80% 60%)`);
  // Pairs are often near-opposites, and blending opposites passes through
  // grey, so each color holds solid for a third and the blend (in OKLab,
  // which stays cleaner than sRGB) is kept to the middle.
  return b ? `linear-gradient(135deg in oklab, ${a} 0%, ${a} 33%, ${b} 67%, ${b} 100%)` : a;
}

function columnCount(width: number) {
  if (width < 520) return 1;
  if (width < 900) return 2;
  if (width < 1300) return 3;
  return 4;
}

type Props = {
  items: Artwork[];
  /** The colors these results were searched for; hover borders and glows use them. */
  hues: number[];
  dimmed: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (index: number, from: HTMLElement) => void;
};

export function Gallery({ items, hues, dimmed, hasMore, loadingMore, onLoadMore, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setCols(columnCount(e.contentRect.width)));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);

  // Each item goes to the currently shortest column. Because aspect ratios are
  // known up front, earlier items never move when later pages arrive, unlike
  // CSS columns, which reflow the whole grid on every append.
  const columns = useMemo(() => {
    const out: { art: Artwork; index: number }[][] = Array.from({ length: cols }, () => []);
    const heights = new Array(cols).fill(0);
    items.forEach((art, index) => {
      const c = heights.indexOf(Math.min(...heights));
      out[c].push({ art, index });
      heights[c] += art.height / art.width + CAPTION;
    });
    return out;
  }, [items, cols]);

  const paint = searchPaint(hues);

  // Start fetching well before the bottom so scrolling never waits.
  useEffect(() => {
    if (!hasMore) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && onLoadMore(), { rootMargin: "1600px 0px" });
    io.observe(sentinel.current!);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <div ref={ref}>
      <div
        className="flex gap-6 transition-opacity duration-300 sm:gap-8"
        style={{ opacity: dimmed ? 0.35 : 1 }}
        aria-busy={dimmed}
      >
        {columns.map((col, c) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col gap-10">
            {col.map(({ art, index }) => (
              <Card key={art.id} art={art} paint={paint} delay={(index % 30) * 35} onOpen={(el) => onOpen(index, el)} />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-px" />
      {loadingMore && (
        <div className="flex justify-center py-12" role="status">
          <span className="size-2 animate-ping rounded-full" style={{ backgroundColor: "hsl(var(--hue) 70% 60%)" }} />
          <span className="sr-only">Loading more works</span>
        </div>
      )}
      {!hasMore && items.length > 0 && (
        <p className="py-16 text-center font-serif text-sm text-white/35 italic">That&apos;s every work in this color.</p>
      )}
    </div>
  );
}

type CardProps = { art: Artwork; paint: string; delay: number; onOpen: (el: HTMLElement) => void };

function Card({ art, paint, delay, onOpen }: CardProps) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <button
      type="button"
      onClick={() => onOpen(frame.current!)}
      className="rise group block w-full text-left outline-none"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Glow, border and image scale together. Glow and border are layers
          painted in the searched color(s), since a box-shadow or border
          can't be a gradient. */}
      <div className="relative transition-transform duration-500 ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03] motion-reduce:transform-none">
        <div
          aria-hidden
          className="absolute inset-x-[8%] top-[18%] -bottom-[7%] opacity-35 blur-2xl transition-opacity duration-500 group-hover:opacity-80 group-focus-visible:opacity-80"
          style={{ background: paint }}
        />
        <div
          aria-hidden
          className="absolute -inset-[3px] rounded-[5px] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ background: paint }}
        />
        <div
          ref={frame}
          className="relative overflow-hidden rounded-sm bg-[#0c0c0e]"
          style={{ aspectRatio: `${art.width} / ${art.height}` }}
        >
          {art.lqip && (
            <div
              aria-hidden
              className="absolute inset-0 scale-110 bg-cover blur-xl"
              style={{ backgroundImage: `url(${art.lqip})` }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(art)}
            alt={art.alt ?? art.title}
            loading="lazy"
            decoding="async"
            // The museum's image server blocks hotlinked requests that carry a
            // referrer from another site.
            referrerPolicy="no-referrer"
            // A cached image can finish before React hydrates and attaches
            // onLoad, so check `complete` on mount too.
            ref={(el) => {
              if (el?.complete && el.naturalWidth) el.dataset.loaded = "";
            }}
            onLoad={(e) => (e.currentTarget.dataset.loaded = "")}
            // If the image server still refuses, keep the blurred preview
            // rather than a broken-image icon.
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            className="relative h-full w-full object-cover opacity-0 transition-opacity duration-700 data-loaded:opacity-100"
          />
        </div>
      </div>
      <div className="mt-3 space-y-0.5 px-0.5">
        <h3 className="line-clamp-2 font-serif text-[15px] leading-snug text-white/90 transition-colors group-hover:text-white">
          {art.title}
        </h3>
        <p className="truncate text-xs text-white/45">
          {[art.artist, art.date].filter(Boolean).join(" · ") || art.type}
        </p>
      </div>
    </button>
  );
}
