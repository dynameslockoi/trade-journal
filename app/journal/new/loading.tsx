import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/skeletons";

/** Matches app/journal/new/page.tsx's own PageHeader copy exactly, so nothing shifts on mount. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader
        eyebrow="Journal / New Trade"
        title="Add Trade"
        subtitle="Enter the position in lots; charges and gross P&L follow from the shares and your broker preset."
      />
      <CardSkeleton lines={10} />
    </div>
  );
}
