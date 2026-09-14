"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisProps, gridProps, tooltipProps } from "@/components/chart-theme";

export function EquityChart({ data }: { data?: { d: string; v: number }[] }) {
  if (!data?.length) {
    return <div className="empty" style={{ height: 310 }}>No trades match these filters yet.</div>;
  }
  return (
    <div style={{ height: 310 }}>
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
