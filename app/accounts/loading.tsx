import { PageHeader } from "@/components/page-header";
import { StatsSkeleton } from "@/components/skeletons";

/** Mirrors app/accounts/page.tsx's own `loading ? <StatsSkeleton count={3}/>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Accounts" subtitle="Money in and out, live journal equity, broker fees and risk limits." />
      <StatsSkeleton count={3} />
    </div>
  );
}
