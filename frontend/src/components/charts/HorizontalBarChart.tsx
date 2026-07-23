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
            width={140}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-ink)" }}
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
