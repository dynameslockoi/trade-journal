import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/skeletons";

/** Symbol isn't known until the trade loads, so "Edit {symbol}" is a shimmer block, not guessed text. */
export default function Loading() {
  return (
    <div className="content">
      <header className="page-head">
        <div className="eyebrow">Journal / Edit Trade</div>
        <div className="page-head-row">
          <div className="page-head-text">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="mt-2.5 h-3 w-64" />
          </div>
        </div>
      </header>
      <CardSkeleton lines={10} />
    </div>
  );
}
