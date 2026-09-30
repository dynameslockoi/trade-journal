import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";

/** Mirrors app/calendar/page.tsx's own `loading ? <><StatsSkeleton/><CardSkeleton lines={8}/></>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="P&L Calendar" subtitle="Daily realised P&L, trade count and return on capital." />
      <StatsSkeleton />
      <CardSkeleton lines={8} />
    </div>
  );
}
