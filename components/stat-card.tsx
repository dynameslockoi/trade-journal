import { Sparkline } from "@/components/sparkline";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Metric card for the dashboard, analytics and calendar. `trend` is optional: when given, a
 * sparkline of that series sits under the figure (two points minimum), coloured by the tone.
 */
export function StatCard({
  label,
  value,
  sub,
  positive,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  trend?: number[];
}) {
  const tone = positive === true ? "positive" : positive === false ? "negative" : "";
  const trendTone = positive === true ? "positive" : positive === false ? "negative" : "accent";
  return (
    <Card className={cn("stat-card", tone)}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {trend && <Sparkline values={trend} tone={trendTone} />}
    </Card>
  );
}
