"use client";

import { useRef } from "react";
import { countAt, HISTOGRAM_STEP, hueName } from "@/lib/color";
import { hueDistance } from "@/lib/palette";

// Geometry in % of the wheel's width (the wheel is a square).
const RING_OUTER = 37;
const RING_INNER = 29;
const KNOB_R = (RING_OUTER + RING_INNER) / 2;
const BARS_FROM = 40;
const BARS_MAX = 9;

// Server and browser trig can differ in the last digits, which breaks
// hydration, so coordinates are rounded.
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const RING_GRADIENT = `conic-gradient(${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 78% 56%)`).join(",")})`;

type Props = {
  /** One hue, or two for a pair. */
  hues: number[];
  /** Which knob the keyboard moves. */
  active: number;
  /** Bars for the active knob: with a pair, counts of works containing both. */
  histogram: number[];
  /** The real result count once a search for these hues has landed. */
  exactCount: number | null;
  onActivate: (index: number) => void;
  /** Fires continuously while dragging, for live preview. */
  onPreview: (hues: number[]) => void;
  /** Fires once the user settles; this is what triggers a search. */
  onCommit: (hues: number[]) => void;
};

export function Wheel({ hues, active, histogram, exactCount, onActivate, onPreview, onCommit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const angleAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { hue: Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360), dist: Math.hypot(dx, dy) / r.width };
  };
  const withHue = (i: number, h: number) => hues.map((x, j) => (j === i ? h : x));

  const onPointerDown = (e: React.PointerEvent) => {
    const { hue: h, dist } = angleAt(e);
    if (dist < 0.2) return; // the center swatch isn't a drag target
    // Grab whichever knob is closer to where the pointer landed.
    const knob = hues.length > 1 && hueDistance(h, hues[1 - active]) < hueDistance(h, hues[active]) ? 1 - active : active;
    if (knob !== active) onActivate(knob);
    dragging.current = knob;
    ref.current!.setPointerCapture(e.pointerId);
    onPreview(withHue(knob, h));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current !== null) onPreview(withHue(dragging.current, angleAt(e).hue));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    const knob = dragging.current;
    dragging.current = null;
    onCommit(withHue(knob, angleAt(e).hue));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : HISTOGRAM_STEP;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const next = withHue(active, (hues[active] + delta + 360) % 360);
    onPreview(next);
    // Holding an arrow key shouldn't fire a search per keystroke.
    clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => onCommit(next), 350);
  };

  const hue = hues[active];
  const max = Math.max(1, ...histogram);
  const count = exactCount ?? countAt(histogram, hue);
  const label = hues.map(hueName).join(" + ");
  const pair = hues.length > 1;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={pair ? `Color ${active + 1} of 2` : "Color"}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={hue}
      aria-valuetext={`${label}, ${exactCount === null ? "about " : ""}${count.toLocaleString()} works`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (dragging.current = null)}
      onKeyDown={onKeyDown}
      className="group relative aspect-square w-[min(420px,86vw)] cursor-grab touch-none select-none rounded-full outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-8 focus-visible:ring-offset-transparent"
    >
      {/* How much art lives at each hue (or, for a pair, pairs with the other
          color). Square-root scaling keeps the warm spike from flattening
          everything else. */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 overflow-visible" aria-hidden>
        {histogram.map((n, i) => {
          const a = ((i * HISTOGRAM_STEP) * Math.PI) / 180;
          const len = n === 0 ? 0.4 : 1 + BARS_MAX * Math.sqrt(n / max);
          const near = hueDistance(i * HISTOGRAM_STEP, hue) <= 12;
          return (
            <line
              key={i}
              x1={r3(50 + BARS_FROM * Math.sin(a))}
              y1={r3(50 - BARS_FROM * Math.cos(a))}
              x2={r3(50 + (BARS_FROM + len) * Math.sin(a))}
              y2={r3(50 - (BARS_FROM + len) * Math.cos(a))}
              stroke={`hsl(${i * HISTOGRAM_STEP} 72% ${near ? 70 : 58}%)`}
              strokeOpacity={near ? 1 : 0.42}
              strokeWidth={near ? 1.5 : 1.1}
              strokeLinecap="round"
              className="transition-[stroke-opacity] duration-300"
            />
          );
        })}
      </svg>

      <div
        aria-hidden
        className="absolute rounded-full shadow-[0_0_60px_-10px_rgba(0,0,0,.8)]"
        style={{
          inset: `${50 - RING_OUTER}%`,
          background: RING_GRADIENT,
          mask: `radial-gradient(circle, transparent ${(RING_INNER / RING_OUTER) * 70.7}%, #000 ${(RING_INNER / RING_OUTER) * 70.7 + 0.5}%)`,
        }}
      />

      <div
        aria-hidden
        className="absolute flex flex-col items-center justify-center overflow-hidden rounded-full text-center transition-[box-shadow] duration-500"
        style={{
          inset: "27%",
          background: pair
            ? `linear-gradient(90deg, hsl(${hues[0]} 62% 46%) 50%, hsl(${hues[1]} 62% 46%) 50%)`
            : `hsl(${hue} 62% 46%)`,
          boxShadow: pair
            ? `-30px 0 70px -6px hsl(${hues[0]} 70% 50% / .45), 30px 0 70px -6px hsl(${hues[1]} 70% 50% / .45)`
            : `0 0 80px 4px hsl(${hue} 70% 50% / .45), inset 0 -18px 40px hsl(${hue} 70% 20% / .5)`,
        }}
      >
        <span
          className={`px-3 font-serif leading-tight italic [text-shadow:0_1px_12px_rgba(0,0,0,.45)] ${
            pair ? "text-[clamp(1rem,3.6vw,1.35rem)]" : "text-[clamp(1.4rem,5vw,2rem)] leading-none"
          }`}
        >
          {pair ? (
            <>
              {hueName(hues[0])}
              <br />+ {hueName(hues[1])}
            </>
          ) : (
            label
          )}
        </span>
        <span className="mt-2 text-xs tracking-wide text-white/80 tabular-nums [text-shadow:0_1px_8px_rgba(0,0,0,.5)]">
          {exactCount === null && "~"}
          {count.toLocaleString()} works
        </span>
      </div>

      {hues.map((h, i) => {
        const rad = (h * Math.PI) / 180;
        const isActive = i === active;
        return (
          <div
            key={i}
            aria-hidden
            className={`pointer-events-none absolute -translate-1/2 rounded-full shadow-[0_2px_14px_rgba(0,0,0,.6)] transition-[width,height,border-color] ${
              isActive ? "size-[9%] border-[3px] border-white group-active:scale-110" : "size-[7%] border-2 border-white/55"
            }`}
            style={{
              left: `${r3(50 + KNOB_R * Math.sin(rad))}%`,
              top: `${r3(50 - KNOB_R * Math.cos(rad))}%`,
              backgroundColor: `hsl(${h} 78% 56%)`,
            }}
          />
        );
      })}
    </div>
  );
}
