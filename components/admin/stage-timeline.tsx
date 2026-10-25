import { AlertTriangle, CheckCircle2, Hammer, ShieldCheck, Wrench, XCircle, Rocket } from "lucide-react";
import type { BuildStage } from "@/lib/failures";
import { cn } from "@/lib/utils";

function fmtSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

const STAGE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  Prepare: { icon: Rocket, tone: "text-slate-600" },
  Agent: { icon: Hammer, tone: "text-sky-700" },
  Repair: { icon: Wrench, tone: "text-amber-600" },
  QA: { icon: ShieldCheck, tone: "text-pine-800" },
  Finished: { icon: CheckCircle2, tone: "text-emerald-600" },
  Failed: { icon: XCircle, tone: "text-red-600" },
};

export function StageTimeline({
  stages,
  durations,
  totalSeconds,
}: {
  stages: BuildStage[];
  durations: { stage: string; seconds: number }[];
  totalSeconds: number;
}) {
  if (!stages.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <AlertTriangle className="size-4" aria-hidden="true" />
        No stage markers found in this log.
      </p>
    );
  }
  const byName = new Map(durations.map((d) => [d.stage, d.seconds]));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {stages.map((s, i) => {
          const meta = STAGE_META[s.stage] ?? { icon: Rocket, tone: "text-slate-600" };
          const Icon = meta.icon;
          const secs = byName.get(s.stage) ?? 0;
          const pct = totalSeconds > 0 ? Math.max(2, Math.round((secs / totalSeconds) * 100)) : 0;
          return (
            <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
              {i > 0 && <div className="h-px w-4 shrink-0 bg-slate-200" aria-hidden="true" />}
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <Icon className={cn("size-4 shrink-0", meta.tone)} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{s.stage}</span>
                    <span className="text-[10px] tabular-nums text-slate-400">{fmtSeconds(secs)}</span>
                  </div>
                  <div className="mt-1 h-1 w-full min-w-16 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", s.stage === "Failed" ? "bg-red-500" : s.stage === "Finished" ? "bg-emerald-500" : "bg-pine-700")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">
        {stages.map((s) => s.stage).join(" → ")} — total {fmtSeconds(totalSeconds)}
      </p>
    </div>
  );
}
