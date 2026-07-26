import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

export interface TrendPoint {
  x: string;
  y: number;
}

export interface TrendLineChartProps {
  data: TrendPoint[];
  height?: number;
  className?: string;
  /** CSS color (usually a `var(--color-*)` token) for the single series. */
  color?: string;
  valueFormatter?: (n: number) => string;
  yLabel?: string;
}

/**
 * A single-series trend line — one hue, so no categorical palette is
 * needed (identity is carried by the chart's own title, not color). Used
 * for magnitude-over-time reads like cumulative CSP.
 */
export function TrendLineChart({
  data,
  height = 220,
  className,
  color = "var(--color-brand)",
  valueFormatter = (n) => n.toLocaleString(),
  yLabel,
}: TrendLineChartProps) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -20, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-line" vertical={false} />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
            tickLine={false}
            width={40}
            label={
              yLabel
                ? {
                    value: yLabel,
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: "var(--color-ink-faint)", fontSize: 11 },
                  }
                : undefined
            }
          />
          <Tooltip
            formatter={(value: unknown) => valueFormatter(Number(value))}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              fontSize: 13,
            }}
            labelStyle={{ color: "var(--color-ink-muted)" }}
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: color }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
