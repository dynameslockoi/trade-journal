import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";

/** Mirrors app/analytics/page.tsx's own `loading ? <><StatsSkeleton rows={2}/><CardSkeleton lines={6}/></>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Analytics" subtitle="Measure where your edge actually comes from." />
      <StatsSkeleton rows={2} />
      <CardSkeleton lines={6} />
    </div>
  );
}
