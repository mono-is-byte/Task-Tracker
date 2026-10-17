"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One scrollable container for every history / activity / changelog / comments
 * list in the app (item 8): a fixed max height with `overflow-y: auto` so a
 * long list never stretches the page, a sticky header slot that stays visible
 * while the list scrolls, a subtle bottom fade when there is more to see, and
 * optional "load more" pagination for long lists.
 *
 * Scroll behaviour: items are appended at the BOTTOM (chronological, oldest →
 * newest) which keeps the newest item visible; when new items arrive while the
 * user is reading further up, the position is preserved (no jump). An empty
 * list renders a short message instead of a tall empty box.
 */
export default function ScrollableList({
  items,
  renderItem,
  header,
  emptyText = "No activity yet.",
  /** Cap height class — keep the page itself short. */
  maxH = "max-h-80",
  /** Render at most this many items at a time; a "Load more" button reveals the
   *  rest. Disabled (0) when the list is short. */
  pageSize = 0,
  /** Accessible/aria label for the list. */
  label,
}: {
  items: unknown[];
  renderItem: (item: unknown, index: number) => React.ReactNode;
  /** Sticky section header (title, filter tabs…) — stays outside the scroll. */
  header?: React.ReactNode;
  emptyText?: string;
  maxH?: string;
  pageSize?: number;
  label?: string;
}) {
  const effectivePageSize = pageSize > 0 ? pageSize : items.length;
  const [shown, setShown] = useState(effectivePageSize);
  useEffect(() => { setShown(effectivePageSize); }, [effectivePageSize, items.length]);

  const scrollRef = useRef<HTMLUListElement | null>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Track whether the user is reading near the bottom; only then do we follow
  // new items — never yank the view while they read history further up.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
  }, []);

  // Keep the newest item in view when it arrives AND the user was at the bottom.
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const visible = items.slice(0, shown);
  const hidden = items.length - visible.length;

  return (
    <div className="flex min-h-0 flex-col">
      {header && (
        <div className="sticky top-0 z-10 mb-1 flex items-center gap-2 bg-surface pb-1">
          {header}
        </div>
      )}
      <div className="relative min-h-0">
        <ul
          ref={scrollRef}
          onScroll={onScroll}
          aria-label={label}
          className={`scroll-fade-bottom${atBottom ? " is-bottom" : ""} flex flex-col gap-1 overflow-y-auto overscroll-contain text-xs ${maxH} scroll-thin`}
        >
          {visible.map((item, i) => (
            <li key={(item as { id?: string })?.id ?? i}>{renderItem(item, i)}</li>
          ))}
          {items.length === 0 && <li className="text-xs text-slate-400">{emptyText}</li>}
        </ul>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {hidden > 0
            ? `Showing ${visible.length} of ${items.length}`
            : items.length > 0
              ? `${items.length} item${items.length === 1 ? "" : "s"}`
              : ""}
        </span>
        <span className="flex items-center gap-2">
          {!atBottom && items.length > 0 && (
            <button
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className="rounded border px-2 py-0.5 hover:bg-line dark:border-slate-700"
            >
              ↓ Jump to newest
            </button>
          )}
          {hidden > 0 && (
            <button
              onClick={() => setShown((n) => n + Math.max(pageSize, 20))}
              className="rounded border px-2 py-0.5 hover:bg-line dark:border-slate-700"
            >
              Load more ({hidden})
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
