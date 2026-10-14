/**
 * Tiny trend line for metric cards: no axes, no labels, no charting dependency. The colour comes
 * from `currentColor`, so the line and its fill follow the theme and the card's tone for free.
 */
const WIDTH = 100;
const HEIGHT = 30;
const PAD = 3;

/**
 * Bar trend for metric cards, for a series that reads better as a histogram than a line: trades per
 * day, profit factor, counts. Long series are folded into at most `maxBars` buckets — summed for a
 * count, averaged for a ratio — so a ninety-day window still fits a 90 px tile. Like `Sparkline`,
 * the colour comes from `currentColor` so it follows the theme and the card's tone.
 */
export function SparkBars({
  values,
  tone = "accent",
  height = 34,
  maxBars = 20,
  bucket = "mean",
}: {
  values: number[];
  tone?: "accent" | "positive" | "negative" | "muted";
  height?: number;
  maxBars?: number;
  /** How a bucket of several values collapses to one bar — a count sums, a ratio averages. */
  bucket?: "mean" | "sum";
}) {
  const series = values.filter(value => Number.isFinite(value));
  // A trend needs two points; a filter set with one trade simply shows no bars.
  if (series.length < 2) return null;

  const count = Math.min(maxBars, series.length);
  const chunk = series.length / count;
  const bars = Array.from({ length: count }, (_, i) => {
    const slice = series.slice(Math.floor(i * chunk), Math.floor((i + 1) * chunk));
    if (!slice.length) return 0;
    const total = slice.reduce((sum, value) => sum + value, 0);
    return bucket === "sum" ? total : total / slice.length;
  });
  const peak = Math.max(...bars, 0);
  // An all-zero run settles on a flat baseline of hairline bars rather than dividing by nothing.
  const scale = peak > 0 ? peak : 1;
  const slot = WIDTH / count;
  const barWidth = Math.max(slot * 0.62, 0.7);

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
        {bars.map((value, i) => {
          const h = Math.max((Math.max(value, 0) / scale) * (HEIGHT - PAD * 2), 0.8);
          return (
            <rect
              key={i}
              x={(i * slot + (slot - barWidth) / 2).toFixed(2)}
              y={(HEIGHT - PAD - h).toFixed(2)}
              width={barWidth.toFixed(2)}
              height={h.toFixed(2)}
              rx={0.8}
              fill="currentColor"
              fillOpacity={0.72}
            />
          );
        })}
      </svg>
    </div>
  );
}

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
