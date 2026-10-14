import { Info } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Metric card for the dashboard, analytics and calendar.
 *
 * Two layouts share one surface. Given `delta` or `chart` the card is the dashboard's split tile:
 * the figure and its change on the left, a small trend on the right, so four of them fit one row
 * without the sparkline pushing the number down. Otherwise it keeps the stacked layout the other
 * pages use — figure, sub-line, then a line trend underneath.
 *
 * `trend` is the line series for the stacked layout; `chart` is any node (a line or `SparkBars`)
 * for the split one. `hint` adds a small info marker for a metric that needs a definition.
 */
export function StatCard({
  label,
  value,
  sub,
  positive,
  trend,
  delta,
  chart,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  trend?: number[];
  /** A change line under the figure in the split layout, e.g. "↑ 12.4%" or "32W / 18L". */
  delta?: React.ReactNode;
  /** The trend drawn beside the figure in the split layout. */
  chart?: React.ReactNode;
  hint?: string;
}) {
  const tone = positive === true ? "positive" : positive === false ? "negative" : "";
  const trendTone = positive === true ? "positive" : positive === false ? "negative" : "accent";
  const split = delta !== undefined || chart !== undefined;

  return (
    <Card className={cn("stat-card", tone, split && "stat-split-card")}>
      <div className="stat-label">
        {label}
        {hint && (
          <span className="stat-info" title={hint} aria-label={hint} role="img">
            <Info size={12} />
          </span>
        )}
      </div>
      {split ? (
        <div className="stat-split">
          <div className="stat-figures">
            <div className="stat-value">{value}</div>
            {delta}
          </div>
          {chart && <div className="stat-chart">{chart}</div>}
        </div>
      ) : (
        <>
          <div className="stat-value">{value}</div>
          {sub && <div className="stat-sub">{sub}</div>}
          {trend && <Sparkline values={trend} tone={trendTone} />}
        </>
      )}
    </Card>
  );
}
