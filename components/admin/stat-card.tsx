import type { ReactNode } from "react";

const TONES = {
  default: "bg-stone-100 text-stone-600",
  pine: "bg-pine-50 text-pine-800",
  gold: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-600",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
        {icon && <span className={`grid h-8 w-8 place-items-center rounded-lg ${TONES[tone]}`}>{icon}</span>}
      </div>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight text-stone-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}
