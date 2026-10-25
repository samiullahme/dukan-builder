import fs from "fs";
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, Hammer, LoaderCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StackedBars } from "@/components/admin/mini-chart";
import { get } from "@/lib/db";
import {
  getBuildStatsOverTime,
  getSignupsOverTime,
  getStageDurations7d,
  getSystemHealth,
} from "@/lib/admin";
import { cn } from "@/lib/utils";

function fmtSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export const dynamic = "force-dynamic";

const OPENCODE_BIN = process.env.OPENCODE_BIN || "/home/builder/.opencode/bin/opencode";

export default async function AdminSystemPage() {
  const [health, buildStats, signups, stageDurations, lastActivity] = await Promise.all([
    getSystemHealth(),
    getBuildStatsOverTime("30d"),
    getSignupsOverTime("30d"),
    getStageDurations7d(),
    get<{ at: string | null }>("SELECT MAX(created_at) AS at FROM builds"),
  ]);

  const agentBinary = fs.existsSync(OPENCODE_BIN);
  const agentActive = (() => {
    if (!lastActivity?.at) return false;
    const last = new Date(lastActivity.at.replace(" ", "T") + "Z").getTime();
    return Date.now() - last < 15 * 60 * 1000;
  })();

  const statusRows = [
    {
      label: "AI agent",
      value: agentBinary ? "Installed" : "Binary missing",
      sub: OPENCODE_BIN,
      ok: agentBinary,
    },
    {
      label: "Build worker",
      value: agentActive ? "Active" : "Idle",
      sub: agentActive ? `last build ${lastActivity?.at ?? ""} UTC` : "no build activity in the last 15 minutes",
      ok: true,
    },
    {
      label: "Queue",
      value: `${health.queued} queued · ${health.building} building`,
      sub: health.queued + health.building > 0 ? "builds waiting or in flight" : "queue is empty",
      ok: health.queued + health.building < 10,
    },
    {
      label: "Deployed version",
      value: `v${health.version}`,
      sub: `built ${health.builtAt}`,
      ok: true,
    },
  ];

  const days = [...buildStats].reverse();
  const signupDays = [...signups].reverse();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-pine-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-400">
              Super admin
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">System</h1>
          <p className="mt-1 text-slate-500">AI agent, build worker, error rate and usage.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statusRows.map((r) => (
          <Card key={r.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{r.label}</span>
                {r.ok ? (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 text-red-600" aria-hidden="true" />
                )}
              </div>
              <div className="mt-1 font-display text-xl font-bold tracking-tight">{r.value}</div>
              <div className="truncate text-xs text-slate-400" title={r.sub}>{r.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hammer className="size-4" aria-hidden="true" />
              Builds per day — last 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {days.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No builds in this period.</p>
            ) : (
              <>
                <StackedBars
                  data={days as unknown as Record<string, number>[]}
                  segments={[
                    { key: "ready", label: "Ready", cls: "bg-pine-700" },
                    { key: "failed", label: "Failed", cls: "bg-red-500" },
                  ]}
                />
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{days[days.length - 1]?.day}</span>
                  <span className="flex gap-3">
                    <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-pine-700" /> ready</span>
                    <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-red-500" /> failed</span>
                  </span>
                  <span>{days[0]?.day}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" aria-hidden="true" />
              Signups per day — last 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {signupDays.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No signups in this period.</p>
            ) : (
              <>
                <StackedBars
                  data={signupDays as unknown as Record<string, number>[]}
                  segments={[{ key: "count", label: "Signups", cls: "bg-gold-500" }]}
                />
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{signupDays[signupDays.length - 1]?.day}</span>
                  <span>{signupDays[0]?.day}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              Average duration by build type — last 7 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stageDurations.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No finished builds in the last 7 days.</p>
            ) : (
              <ul className="space-y-3">
                {stageDurations.map((s) => (
                  <li key={s.kind} className="flex items-center justify-between gap-4">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <Bot className="size-4 text-pine-800" aria-hidden="true" />
                      <span className="capitalize">{s.kind}</span>
                      <span className="text-xs text-slate-400">({s.count} builds)</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{s.avgMinutes} min</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LoaderCircle className="size-4" aria-hidden="true" />
              Last 7 days at a glance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              {[
                { label: "Finished", value: String(health.ready7d) },
                { label: "Failed", value: String(health.failed7d) },
                {
                  label: "Success rate",
                  value: `${health.ready7d + health.failed7d > 0 ? Math.round((health.ready7d / (health.ready7d + health.failed7d)) * 100) : 0}%`,
                },
                { label: "Avg build time", value: fmtSeconds(health.avgBuildSeconds7d) },
              ].map((m) => (
                <div key={m.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{m.label}</dt>
                  <dd className="mt-0.5 font-display text-xl font-bold">{m.value}</dd>
                </div>
              ))}
            </dl>
            <Badge
              variant="outline"
              className={cn(
                "mt-4 border-transparent font-semibold",
                health.failed7d > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
              )}
            >
              {health.failed7d > 0 ? `${health.failed7d} failure${health.failed7d === 1 ? "" : "s"} to investigate` : "All builds passed this week"}
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
