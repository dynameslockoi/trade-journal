/**
 * Recharts falls back to black for bar fills and line strokes, which is invisible on the dark
 * theme, so every chart pulls its colours and axis styling from here. The values are CSS
 * variables, which SVG presentation attributes resolve — so charts re-theme with no re-render.
 */
export const CHART = {
  accent: "var(--accent)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  grid: "var(--chart-grid)",
  axis: "var(--text-faint)",
  tooltipBg: "var(--panel)",
  tooltipBorder: "var(--border)",
  cursorFill: "var(--accent-soft)",
  text: "var(--text)",
  muted: "var(--muted)",
};

export const axisProps = {
  tick: { fill: CHART.axis, fontSize: 11 },
  axisLine: false,
  tickLine: false,
};

export const gridProps = { strokeDasharray: "3 3", stroke: CHART.grid };

export const tooltipProps = {
  contentStyle: { background: CHART.tooltipBg, border: `1px solid ${CHART.tooltipBorder}`, borderRadius: 8, color: CHART.text },
  labelStyle: { color: CHART.muted },
  itemStyle: { color: CHART.text },
};

export const barCursor = { fill: CHART.cursorFill };

/** Green when the value is a profit, red when it is a loss. */
export function pnlColor(value: number) {
  return value >= 0 ? CHART.positive : CHART.negative;
}
