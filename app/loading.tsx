import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";

/**
 * Route-level fallback for `/`. Shown the instant navigation starts — before the client
 * page has even mounted — so the eye lands on a shape instead of a blank frame. Mirrors
 * the page's own `loading ? <Card>...` block (see app/page.tsx) so there's no visible
 * swap once the real data arrives.
 */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Dashboard" subtitle="A clean view of your trading performance and risk." />
      <StatsSkeleton count={4} rows={2} />
      <CardSkeleton lines={6} />
    </div>
  );
}
