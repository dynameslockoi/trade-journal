"use client";

/**
 * Every chart Analytics draws, kept out of `app/analytics/page.tsx` itself.
 *
 * Recharts is the heaviest thing this page loads — the same few hundred kilobytes the dashboard's
 * equity chart pulls in (see `components/equity-chart.tsx`). Analytics draws *ten* charts off one
 * page, so importing recharts at the top of the page file put that whole cost on the page's own
 * bundle, ahead of the stat cards and breakdown tables that don't need it. Split into its own file,
 * `next/dynamic` can load it as a separate chunk (see the `dynamic(...)` calls in the page) so the
 * numbers render immediately and the charts fill in as recharts arrives.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, axisProps, barCursor, gridProps, pnlColor, tooltipProps } from "@/components/chart-theme";
import { formatMoney } from "@/lib/trading";

/** Bar chart of P&L per group, green for profit and red for loss. Used for all eight breakdown cards. */
export function PnlBars({ data, height = 280, currency, tickFontSize = 10, tickInterval }: {
  data: { name: string; pnl: number; trades?: number }[];
  height?: number;
  currency?: string | null;
  /** Banded labels ("9–10 / 10") are wider than strategy names, so they render smaller. */
  tickFontSize?: number;
  /** Set 0 to label every band; by default recharts drops the ones it cannot fit. */
  tickInterval?: number;
}) {
  return (
    <div style={{ height, marginTop: 10 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...axisProps} interval={tickInterval} tick={{ fill: axisProps.tick.fill, fontSize: tickFontSize }} />
          <YAxis {...axisProps} />
          <Tooltip
            {...tooltipProps}
            cursor={barCursor}
            formatter={(value: any, _name: any, item: any) => {
              // An empty band still raises a tooltip from the cursor, so say so rather than "RM 0.00".
              const count = item?.payload?.trades;
              if (!count) return ["no trades", "P&L"];
              return [formatMoney(value, currency, true), `${count} trade${count === 1 ? "" : "s"}`];
            }}
          />
          <Bar dataKey="pnl" radius={[6, 6, 0, 0]} maxBarSize={46}>
            {data.map((d, i) => <Cell key={i} fill={pnlColor(d.pnl)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The filtered equity curve. */
export function AnalyticsEquityCurve({ data }: { data: { x: number; pnl: number }[] }) {
  return (
    <div style={{ height: 300, marginTop: 10 }}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="analyticsEquityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.38} />
              <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="x" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip {...tooltipProps} />
          <Area type="monotone" dataKey="pnl" stroke={CHART.accent} strokeWidth={2.5} fill="url(#analyticsEquityFill)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Count of trades per R-multiple band. */
export function RDistributionChart({ data }: { data: { range: string; count: number }[] }) {
  return (
    <div style={{ height: 300, marginTop: 10 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="range" tick={{ fill: CHART.axis, fontSize: 8.5 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} {...axisProps} />
          <Tooltip {...tooltipProps} cursor={barCursor} />
          <Bar dataKey="count" fill={CHART.accent} radius={[6, 6, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
