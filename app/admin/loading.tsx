import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/skeletons";

/**
 * Mirrors the page's own `overview.loading ? <div className="grid four">...` stat-box
 * fallback. Whether the visitor actually has admin access isn't known yet at this point —
 * the real page still gates on that once it mounts — so this only pre-paints the shape.
 */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader
        eyebrow="Operations"
        title="Admin"
        subtitle="Every account on this journal, what it is using, and whether it can still get in."
      />
      <div className="grid four">
        <Skeleton className="h-[104px]" />
        <Skeleton className="h-[104px]" />
        <Skeleton className="h-[104px]" />
        <Skeleton className="h-[104px]" />
      </div>
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
