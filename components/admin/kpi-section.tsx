"use client";

import Link from "next/link";
import { useState } from "react";
import { Users, Globe, Hammer, CircleCheck, Clock, LoaderCircle, Rocket, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AdminStats, Range } from "@/lib/admin";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

function Trend({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  const delta = current - previous;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {delta > 0 ? "+" : ""}
      {delta}
      {suffix}
      <span className="font-normal text-slate-400">vs prev</span>
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "pine" | "gold" | "red" | "default";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
          <span
            className={cn(
              "grid size-8 place-items-center rounded-lg",
              tone === "pine" && "bg-pine-900 text-gold-400",
              tone === "gold" && "bg-gold-100 text-pine-900",
              tone === "red" && "bg-red-100 text-red-700",
              tone === "default" && "bg-slate-100 text-slate-600"
            )}
          >
            {icon}
          </span>
        </div>
        <div className="font-display text-2xl font-bold tracking-tight">{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function KpiSection({ statsByRange, asOf }: { statsByRange: Record<Range, AdminStats>; asOf: string }) {
  const [range, setRange] = useState<Range>("7d");
  const s = statsByRange[range];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          value={[range]}
          onValueChange={(v) => {
            if (v && v.length) setRange(v[0] as Range);
          }}
          variant="outline"
        >
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} aria-label={`Last ${r.label}`}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-slate-400">Data as of {asOf} UTC</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Users"
          value={s.users}
          sub={<Trend current={s.users} previous={s.usersPrev} />}
          icon={<Users className="size-4" aria-hidden="true" />}
          tone="pine"
        />
        <KpiCard
          label="Websites"
          value={s.sites}
          sub={<Trend current={s.sites} previous={s.sitesPrev} />}
          icon={<Globe className="size-4" aria-hidden="true" />}
          tone="gold"
        />
        <KpiCard
          label="Builds"
          value={s.builds}
          sub={<Trend current={s.builds} previous={s.buildsPrev} />}
          icon={<Hammer className="size-4" aria-hidden="true" />}
        />
        <KpiCard
          label="Build success"
          value={`${s.successRate}%`}
          sub={
            s.failed > 0 ? (
              <Link href="/admin/builds?status=failed" className="font-semibold text-red-600 hover:underline">
                {s.failed} failed builds →
              </Link>
            ) : (
              <span className="text-emerald-600">All builds passed</span>
            )
          }
          icon={<CircleCheck className="size-4" aria-hidden="true" />}
          tone={s.failed > 0 ? "red" : "pine"}
        />
        <KpiCard
          label="Avg build time"
          value={formatDuration(new Date(Date.now() - s.avgBuildSeconds * 1000).toISOString(), new Date().toISOString())}
          sub={<span>across finished builds</span>}
          icon={<Clock className="size-4" aria-hidden="true" />}
        />
        <KpiCard
          label="In flight"
          value={`${s.activeBuilds} / ${s.queuedBuilds}`}
          sub={<span className="text-slate-500">building / queued</span>}
          icon={<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        />
        <KpiCard
          label="Published rate"
          value={`${s.publishedRate}%`}
          sub={
            <>
              <span className="font-semibold text-pine-800">{s.published}</span> of {s.sites} sites live
            </>
          }
          icon={<Rocket className="size-4" aria-hidden="true" />}
          tone="gold"
        />
      </div>
    </div>
  );
}
