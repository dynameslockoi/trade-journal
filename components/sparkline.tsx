/**
 * Tiny trend line for metric cards: no axes, no labels, no charting dependency. The colour comes
 * from `currentColor`, so the line and its fill follow the theme and the card's tone for free.
 */
const WIDTH = 100;
const HEIGHT = 30;
const PAD = 3;

export function Sparkline({
  values,
  tone = "accent",
  height = 34,
}: {
  values: number[];
  tone?: "accent" | "positive" | "negative";
  height?: number;
}) {
  // A trend needs two points; a filter set with one trade simply shows no line.
  const series = values.filter(value => Number.isFinite(value));
  if (series.length < 2) return null;

  let min = series[0];
  let max = series[0];
  for (const value of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // A flat run (e.g. an unchanging win rate) sits centred instead of hugging the floor.
  const flat = max === min;
  const toY = (value: number) => (flat ? HEIGHT / 2 : HEIGHT - PAD - ((value - min) / (max - min)) * (HEIGHT - PAD * 2));
  const points = series.map((value, index) => [(index / (series.length - 1)) * WIDTH, toY(value)] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");

  return (
    <div className="stat-spark" style={{ height, color: `var(--${tone})` }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
      >
        {/* A flat run gets the line only: a filled band would read as a solid block, not "no change". */}
        {!flat && <path d={`${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`} fill="currentColor" fillOpacity={0.14} />}
        {/* The viewBox is stretched, so the stroke width is pinned to device pixels. */}
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
