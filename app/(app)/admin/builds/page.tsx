import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { BuildStatusBadge, FailureBadge, KindBadge, ReviewedBadge } from "@/components/admin/badges";
import { listRecentBuilds, type AdminBuildRow } from "@/lib/admin";
import { FAILURE_LABELS, parseBuildStages, type FailureReason } from "@/lib/failures";
import { formatDateTime, formatDuration, lastLogLine, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function lastStage(log: string): string | null {
  const stages = parseBuildStages(log);
  return stages.length ? stages[stages.length - 1].stage : null;
}

export default async function AdminBuildsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string; reviewed?: string }>;
}) {
  const { status, reason, reviewed } = await searchParams;
  const builds = listRecentBuilds(500).then((all) =>
    all.filter(
      (b) =>
        (!status || b.status === status) &&
        (!reason || (b.failure_reason ?? "unknown") === reason) &&
        (!reviewed || (reviewed === "yes" ? b.reviewed === 1 : b.reviewed === 0))
    )
  );

  const columns: AdminColumn<AdminBuildRow>[] = [
    {
      key: "site",
      header: "Website",
      sortable: true,
      sortValue: (r) => r.business_name,
      render: (r) => (
        <div>
          <Link href={`/admin/builds/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.business_name}
          </Link>
          <div className="text-xs text-slate-400">{r.owner_email}</div>
        </div>
      ),
    },
    { key: "kind", header: "Type", sortable: true, sortValue: (r) => r.kind, render: (r) => <KindBadge kind={r.kind} /> },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <BuildStatusBadge status={r.status} />
          {r.failure_reason && <FailureBadge reason={r.failure_reason} />}
        </span>
      ),
    },
    {
      key: "stopped",
      header: "Stopped at",
      sortable: true,
      sortValue: (r) => lastStage(r.log ?? "") ?? "",
      render: (r) => {
        const stage = lastStage(r.log ?? "");
        if (!stage) return <span className="text-slate-300">—</span>;
        return <span className={stage === "Failed" ? "font-semibold text-red-700" : "text-slate-500"}>{stage}</span>;
      },
      hideBelow: "md",
    },
    {
      key: "last_line",
      header: "Last log line",
      sortable: false,
      render: (r) => (
        <span className="block max-w-72 truncate font-mono text-xs text-slate-500" title={lastLogLine(r.log, 500)}>
          {lastLogLine(r.log)}
        </span>
      ),
      hideBelow: "lg",
    },
    {
      key: "duration",
      header: "Duration",
      sortable: false,
      render: (r) => <span className="tabular-nums text-slate-600">{formatDuration(r.started_at, r.finished_at)}</span>,
      hideBelow: "md",
    },
    {
      key: "reviewed",
      header: "Review",
      sortable: true,
      sortValue: (r) => r.reviewed,
      render: (r) => <ReviewedBadge reviewed={r.reviewed} />,
      hideBelow: "lg",
    },
    {
      key: "created",
      header: "When",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => <span title={formatDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>,
    },
  ];

  const reasonKeys = Object.keys(FAILURE_LABELS) as FailureReason[];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-pine-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-400">
              Super admin
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Builds</h1>
          <p className="mt-1 text-slate-500">Every build run — open one to read its full log and see where it stopped.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { label: "All", href: "/admin/builds" },
          { label: "Failed", href: "/admin/builds?status=failed" },
          { label: "Building", href: "/admin/builds?status=building" },
          { label: "Queued", href: "/admin/builds?status=queued" },
          { label: "Ready", href: "/admin/builds?status=ready" },
          { label: "Cancelled", href: "/admin/builds?status=cancelled" },
          { label: "Needs review", href: "/admin/builds?status=failed&reviewed=no" },
        ].map((f) => {
          const url = new URL(f.href, "https://x");
          const fStatus = url.searchParams.get("status");
          const fReviewed = url.searchParams.get("reviewed");
          const active =
            (fStatus ? fStatus === status : !status) && (fReviewed ? fReviewed === reviewed : !reviewed);
          return (
            <Link
              key={f.href}
              href={f.href}
              className={
                active
                  ? "rounded-full bg-pine-900 px-3 py-1.5 text-xs font-semibold text-gold-400"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-pine-700 hover:text-pine-900"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {status === "failed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reasonKeys.map((k) => (
            <Link
              key={k}
              href={`/admin/builds?status=failed&reason=${k}`}
              className={
                reason === k
                  ? "rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-400"
              }
            >
              {FAILURE_LABELS[k]}
            </Link>
          ))}
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        <DataTable
          {...toTable(columns, await builds, {
            key: (r) => r.id,
            search: (r) => `${r.business_name} ${r.owner_email} ${r.slug}`,
            csv: (r) => ({
              business_name: r.business_name,
              owner: r.owner_email,
              kind: r.kind,
              status: r.status,
              failure_reason: r.failure_reason ?? "",
              stopped_at_stage: lastStage(r.log ?? "") ?? "",
              duration_s: r.started_at && r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : "",
              created: r.created_at,
              reviewed: r.reviewed ? "yes" : "no",
            }),
          })}
          searchPlaceholder="Search by website or owner…"
          csvName="dukan-builds"
          emptyTitle="No builds found"
          emptyDescription="Try a different search or clear the filters."
        />
      </Card>
    </div>
  );
}
