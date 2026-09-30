import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/skeletons";

/** Mirrors the page's `grid two` of a Daily Review card and a Weekly Review card. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Reviews" subtitle="Turn your trading history into repeatable improvements." />
      <div className="grid two">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
