import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";

/** Mirrors app/zakat/page.tsx's own `loading ? <><StatsSkeleton count={3}/><CardSkeleton lines={6}/></>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader
        title="Zakat"
        subtitle="A journal estimate — 2.5% of the year's net trading profit, less what you have already paid. Confirm the basis and rate with your zakat authority."
      />
      <StatsSkeleton count={3} />
      <CardSkeleton lines={6} />
    </div>
  );
}
