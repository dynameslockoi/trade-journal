import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders shaped like the content that is coming.
 *
 * A page that waits behind the words "Loading your journal…" looks slower than the same wait behind a
 * table that is already the right height — the eye is reading the layout instead of reading nothing.
 * These blocks copy the real card and column structure, so the content lands where the placeholder was
 * rather than pushing the page around.
 *
 * The lower rows fade out, because a placeholder that stops crisply reads as the end of a list instead
 * of the start of a load.
 */

const cols = (n: number) => ({
  display: "grid",
  gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
  gap: 14,
  alignItems: "center",
}) as const;

const fade = (row: number, rows: number) => ({ opacity: Math.max(0.25, 1 - Math.max(row - Math.max(rows - 3, 1), 0) / 3) });

/** A card of shimmer rows, for the journal's table. */
export function TableSkeleton({ rows = 8, columns = 7 }: { rows?: number; columns?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <div className="card-content grid gap-3">
        <div style={cols(columns)}>
          {Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-2.5 opacity-60" />)}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} style={{ ...cols(columns), ...fade(r, rows) }}>
            {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className="h-3" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A row of metric cards, for the dashboard, analytics and calendar headers. */
export function StatsSkeleton({ count = 4, rows = 1 }: { count?: number; rows?: number }) {
  return (
    <div className="grid" style={{ ...cols(count), gap: "var(--section-gap)" }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count * rows }, (_, i) => (
        <div className="card stat-card" key={i}>
          <Skeleton className="h-2.5 w-2/5" />
          <Skeleton className="mt-2.5 h-5 w-3/5" />
          <Skeleton className="mt-2.5 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** A card holding a few lines, for a page that is one list or one form. */
export function CardSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <div className="card-content grid gap-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3" style={{ ...fade(i, lines), width: i === 0 ? "38%" : "100%" }} />
        ))}
      </div>
    </div>
  );
}
