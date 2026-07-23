import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";

export interface TriadSegment {
  label: string;
  value: number;
  /** good | neutral | bad — maps to the validated chart-mark triad tokens. */
  tone: "good" | "neutral" | "bad";
}

const TONE_VAR: Record<TriadSegment["tone"], string> = {
  good: "var(--color-chart-good)",
  neutral: "var(--color-chart-neutral)",
  bad: "var(--color-chart-bad)",
};

export interface StatusTriadChartProps {
  segments: TriadSegment[];
  size?: number;
  className?: string;
}

/**
 * Part-of-whole donut for a small, fixed good/neutral/bad breakdown (e.g.
 * evidence verdicts, on-time/delayed/overdue) — the one place in this app a
 * donut earns its keep, since the three tones are a genuine polarity, not
 * an arbitrary category list. Colors come from the dedicated, validated
 * chart-mark triad (see tokens.css), not the status/severity text tokens.
 * Always paired with a labeled legend row underneath so identity is never
 * color-only, and doubles as the required "table view" of the same data.
 */
export function StatusTriadChart({
  segments,
  size = 140,
  className,
}: StatusTriadChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const nonZero = segments.filter((s) => s.value > 0);

  return (
    <div className={cn("flex items-center gap-5", className)}>
      <div style={{ width: size, height: size }} className="shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={
                nonZero.length > 0
                  ? nonZero
                  : [{ label: "None yet", value: 1, tone: "neutral" as const }]
              }
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={nonZero.length > 1 ? 2 : 0}
              stroke="var(--color-surface)"
              strokeWidth={2}
            >
              {(nonZero.length > 0 ? nonZero : [{ tone: "neutral" as const }]).map(
                (s, i) => (
                  <Cell
                    key={i}
                    fill={nonZero.length > 0 ? TONE_VAR[s.tone] : "var(--color-line)"}
                  />
                ),
              )}
            </Pie>
            {nonZero.length > 0 && (
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  String(value),
                  String(name),
                ]}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: TONE_VAR[s.tone] }}
              aria-hidden="true"
            />
            <span className="text-ink-muted">{s.label}</span>
            <span className="font-mono font-medium text-ink">{s.value}</span>
            <span className="text-ink-faint text-xs">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
