import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/skeletons";

/**
 * The real page renders its two lists behind tabs rather than its own loading
 * skeleton, so this is the only skeleton state a visitor ever sees for this route —
 * shaped like the strategies list, which is the default tab.
 */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader
        title="Strategies & Tags"
        subtitle="The setups you trade and the labels you stick on them — one page, two lists."
      />
      <CardSkeleton lines={8} />
    </div>
  );
}
