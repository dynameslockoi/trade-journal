import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/skeletons";

/** Mirrors app/journal/page.tsx's own `loading ? <TableSkeleton/>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Trade Journal" subtitle="Loading trades…" />
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
