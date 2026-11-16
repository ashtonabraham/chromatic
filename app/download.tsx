"use client";

import { useState } from "react";
import type { Artwork } from "@/lib/aic";
import { downloadSize, downloadUrls } from "@/lib/color";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; note: string } | { kind: "failed" };

const px = (w: number, h: number) => `${w.toLocaleString()} × ${h.toLocaleString()} px`;

/** "Title - Artist (AIC 12345).jpg", minus characters file systems reject. */
function fileName(art: Artwork) {
  const base = [art.title, art.artist].filter(Boolean).join(" - ");
  const clean = base.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  // The catalog number keeps the many "Untitled" works from overwriting each
  // other and points back to the source.
  return `${clean || "Artwork"} (AIC ${art.id}).jpg`;
}

async function fetchImage(url: string) {
  try {
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const result = { blob, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    return null;
  }
}

/**
 * Downloads the largest public image. A plain <a download> doesn't work here:
 * browsers ignore `download` on cross-origin links, and the image server
 * rejects requests carrying our site as referrer. It does allow cross-origin
 * fetches, so we fetch without a referrer and save the result as a file.
 */
export function DownloadButton({ art }: { art: Artwork }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const best = downloadSize(art);

  const download = async () => {
    setState({ kind: "busy" });
    // The server can quietly return a smaller size than requested, so keep
    // going until we get the full size, then save the largest we received.
    let largest: Awaited<ReturnType<typeof fetchImage>> = null;
    for (const url of downloadUrls(art)) {
      const img = await fetchImage(url);
      if (img && (!largest || img.width > largest.width)) largest = img;
      if (largest && largest.width >= best.width - 2) break;
    }
    if (!largest) return setState({ kind: "failed" });

    const href = URL.createObjectURL(largest.blob);
    const a = Object.assign(document.createElement("a"), { href, download: fileName(art) });
    document.body.append(a);
    a.click();
    a.remove();
    // Give the browser a moment to start saving before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    setState({ kind: "done", note: `Saved at ${px(largest.width, largest.height)}` });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={download}
        disabled={state.kind === "busy"}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white/85 disabled:cursor-wait disabled:opacity-70"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" />
        </svg>
        {state.kind === "busy" ? "Downloading…" : "Download image"}
      </button>
      <p className="text-center text-xs text-white/40" aria-live="polite">
        {state.kind === "done"
          ? state.note
          : state.kind === "failed"
            ? "The museum's image server didn't respond. Try the link below."
            : `${px(best.width, best.height)} JPEG · Public domain, free to use`}
      </p>
    </div>
  );
}
