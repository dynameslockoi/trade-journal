"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisProps, gridProps, tooltipProps } from "@/components/chart-theme";

/**
 * The area curve behind the dashboard and the analytics page. `height` lets the dashboard pair it
 * with a column of summary figures without the two ending at different lengths.
 */
export function EquityChart({ data, height = 310 }: { data?: { d: string; v: number }[]; height?: number }) {
  if (!data?.length) {
    return <div className="empty" style={{ height }}>No trades match these filters yet.</div>;
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {/* The stop colours are theme tokens, so the fill follows dark/light automatically. */}
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.38} />
              <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="d" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip {...tooltipProps} contentStyle={{ ...tooltipProps.contentStyle, color: CHART.text }} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={CHART.accent}
            strokeWidth={2.5}
            fill="url(#equityFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
