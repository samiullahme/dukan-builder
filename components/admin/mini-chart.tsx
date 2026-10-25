import { cn } from "@/lib/utils";

export function StackedBars({
  data,
  height = 96,
  segments,
}: {
  data: Record<string, number>[];
  height?: number;
  segments: { key: string; label: string; cls: string }[];
}) {
  const max = Math.max(1, ...data.map((d) => segments.reduce((a, s) => a + (Number(d[s.key]) || 0), 0)));
  return (
    <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label="Daily totals stacked bar chart">
      {data.map((d, i) => {
        const total = segments.reduce((a, s) => a + (Number(d[s.key]) || 0), 0);
        return (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={segments.map((s) => `${s.label}: ${d[s.key] ?? 0}`).join(" · ")}>
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
              {segments.map((s) => {
                const v = Number(d[s.key]) || 0;
                if (!v) return null;
                return <div key={s.key} className={cn("w-full", s.cls)} style={{ height: `${(v / total) * 100}%` }} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
