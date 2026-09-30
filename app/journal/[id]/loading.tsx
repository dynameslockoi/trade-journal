import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/skeletons";

/**
 * The trade's symbol isn't known until it loads, so the header is a plain
 * shimmer block rather than PageHeader with guessed text — matching the
 * page's own `if (loading) return <div className="muted">Loading…</div>`
 * fallback, just shaped like the page that's about to replace it.
 */
export default function Loading() {
  return (
    <div className="content">
      <header className="page-head">
        <div className="page-head-row">
          <div className="page-head-text">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2.5 h-3 w-28" />
          </div>
        </div>
      </header>
      <CardSkeleton lines={8} />
    </div>
  );
}
