import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

const AXIS_WIDTH = 140;
// ~7px per character at 12px in the app's UI face; leaves a little breathing
// room before the bars start.
const MAX_LABEL_CHARS = Math.floor((AXIS_WIDTH - 12) / 7);

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value?: string };
}

/**
 * Recharts wraps an over-long category tick onto a second line, which then
 * collides with the row beneath it ("First complaint bonus" overlapping
 * "Upvote received"). Truncating to one line keeps every row on its own
 * baseline; the full text stays available as a native tooltip.
 */
function CategoryTick({ x = 0, y = 0, payload }: TickProps) {
  const label = payload?.value ?? "";
  const truncated =
    label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={12}
      fill="var(--color-ink)"
      aria-label={label}
    >
      <title>{label}</title>
      {truncated}
    </text>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Per-bar color override (e.g. to flag one row); defaults to `color`. */
  color?: string;
}

export interface HorizontalBarChartProps {
  data: BarDatum[];
  height?: number;
  className?: string;
  /** Single hue for magnitude encoding — identity is carried by the row label, never by color. */
  color?: string;
  valueFormatter?: (n: number) => string;
}

/**
 * Ranked magnitude-by-category bars, single-hue with a direct value label on
 * every bar — deliberately not a multi-color donut/pie, which would need a
 * validated categorical palette for what is really a "compare magnitudes"
 * job, not an identity job. Rows are pre-sorted by the caller (desc by
 * value is the usual choice for a ranked breakdown).
 */
export function HorizontalBarChart({
  data,
  height,
  className,
  color = "var(--color-brand)",
  valueFormatter = (n) => n.toLocaleString(),
}: HorizontalBarChartProps) {
  const rowHeight = 32;
  const resolvedHeight = height ?? Math.max(120, data.length * rowHeight + 16);

  return (
    <div className={cn("w-full", className)} style={{ height: resolvedHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 4, right: 32, top: 4, bottom: 4 }}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={AXIS_WIDTH}
            tickLine={false}
            axisLine={false}
            tick={<CategoryTick />}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value: unknown) => valueFormatter(Number(value))}
              style={{ fill: "var(--color-ink-muted)", fontSize: 12, fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
