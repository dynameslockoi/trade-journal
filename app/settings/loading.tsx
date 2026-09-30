import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/skeletons";

/** Mirrors app/settings/page.tsx's own `loading ? <Card>...Loading your account…</Card>` block. */
export default function Loading() {
  return (
    <div className="content">
      <PageHeader title="Settings" subtitle="Your account, sign-in details and where the journal's numbers come from." />
      <CardSkeleton lines={6} />
    </div>
  );
}
