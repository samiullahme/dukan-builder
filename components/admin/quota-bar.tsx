import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function QuotaBar({ used, allowed, className }: { used: number; allowed: number; className?: string }) {
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
  const exhausted = allowed > 0 && used >= allowed;
  return (
    <div className={cn("w-24", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs font-semibold tabular-nums", exhausted ? "text-red-600" : "text-slate-600")}>
          {used} / {allowed}
        </span>
        {exhausted && <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Full</span>}
      </div>
      <Progress value={pct} className="mt-1" />
    </div>
  );
}
