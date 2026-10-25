import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { KpiSection } from "@/components/admin/kpi-section";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { FailureBadge, KindBadge, SiteStatusBadge, AdminBadge, UserStatusBadge, BuildStatusBadge } from "@/components/admin/badges";
import { QuotaBar } from "@/components/admin/quota-bar";
import {
  getAdminStats,
  getFailureGroups,
  listAdminSites,
  listAdminUsers,
  listRecentBuilds,
  type AdminBuildRow,
  type AdminSiteRow,
  type AdminUserRow,
  type Range,
} from "@/lib/admin";
import { parseBuildStages } from "@/lib/failures";
import { lastLogLine, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGES: Range[] = ["24h", "7d", "30d", "all"];

function lastStage(log: string): string | null {
  const stages = parseBuildStages(log);
  return stages.length ? stages[stages.length - 1].stage : null;
}

export default async function AdminOverview() {
  const [statsByRangeEntries, failureGroups, users, sites, builds] = await Promise.all([
    Promise.all(RANGES.map(async (r) => [r, await getAdminStats(r)] as const)),
    getFailureGroups("7d"),
    listAdminUsers(),
    listAdminSites(),
    listRecentBuilds(20),
  ]);
  const statsByRange = Object.fromEntries(statsByRangeEntries) as Record<Range, (typeof statsByRangeEntries)[number][1]>;

  const asOf = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const userColumns: AdminColumn<AdminUserRow>[] = [
    {
      key: "email",
      header: "User",
      sortable: true,
      sortValue: (r) => r.email,
      render: (r) => (
        <Link href={`/admin/users/${r.id}`} className="font-medium text-slate-900 hover:underline">
          {r.email}
        </Link>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortable: true,
      sortValue: (r) => r.is_admin,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <AdminBadge isAdmin={r.is_admin} />
          <UserStatusBadge status={r.status} />
        </span>
      ),
      hideBelow: "md",
    },
    { key: "sites", header: "Sites", sortable: true, sortValue: (r) => r.sites, render: (r) => <span className="tabular-nums">{r.sites}</span> },
    {
      key: "published",
      header: "Published",
      sortable: true,
      sortValue: (r) => r.published,
      render: (r) => <span className="tabular-nums">{r.published}</span>,
      hideBelow: "md",
    },
    { key: "builds", header: "Builds", sortable: true, sortValue: (r) => r.builds, render: (r) => <span className="tabular-nums">{r.builds}</span> },
    {
      key: "quota",
      header: "Quota",
      sortable: true,
      sortValue: (r) => r.builds_used,
      render: (r) => <QuotaBar used={r.builds_used} allowed={r.builds_allowed} />,
      hideBelow: "lg",
    },
    {
      key: "last_build",
      header: "Last build",
      sortable: true,
      sortValue: (r) => r.last_build_at ?? "",
      render: (r) => relativeTime(r.last_build_at),
      hideBelow: "md",
    },
    {
      key: "joined",
      header: "Joined",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => relativeTime(r.created_at),
      hideBelow: "lg",
    },
  ];

  const siteColumns: AdminColumn<AdminSiteRow>[] = [
    {
      key: "name",
      header: "Website",
      sortable: true,
      sortValue: (r) => r.business_name,
      render: (r) => (
        <div>
          <Link href={`/admin/websites/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.business_name}
          </Link>
          <div className="text-xs text-slate-400">{r.slug}.dukanbot.website</div>
        </div>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortable: true,
      sortValue: (r) => r.owner_email,
      render: (r) => <span className="text-xs text-slate-500">{r.owner_email}</span>,
      hideBelow: "md",
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (r) => r.category,
      render: (r) => <span className="capitalize text-slate-600">{r.category}</span>,
      hideBelow: "lg",
    },
    { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, render: (r) => <SiteStatusBadge status={r.status} /> },
    {
      key: "last_build",
      header: "Last build",
      sortable: true,
      sortValue: (r) => r.last_build_at ?? "",
      render: (r) => relativeTime(r.last_build_at),
      hideBelow: "md",
    },
  ];

  const buildColumns: AdminColumn<AdminBuildRow>[] = [
    {
      key: "site",
      header: "Website",
      sortable: true,
      sortValue: (r) => r.business_name,
      render: (r) => (
        <div>
          <Link href={`/admin/websites/${r.site_id}`} className="font-medium text-slate-900 hover:underline">
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
      sortable: false,
      render: (r) => {
        const stage = lastStage(r.log ?? "");
        if (!stage) return <span className="text-slate-300">—</span>;
        return (
          <span className={stage === "Failed" ? "font-semibold text-red-700" : "text-slate-500"}>
            {stage}
          </span>
        );
      },
      hideBelow: "md",
    },
    {
      key: "last_line",
      header: "Last log line",
      sortable: false,
      render: (r) => <span className="block max-w-64 truncate font-mono text-xs text-slate-500">{lastLogLine(r.log)}</span>,
      hideBelow: "lg",
    },
    {
      key: "created",
      header: "When",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => relativeTime(r.created_at),
      hideBelow: "md",
    },
  ];

  const failedGroups = failureGroups.filter((g) => g.reason !== "unknown");
  const unknownCount = failureGroups.find((g) => g.reason === "unknown")?.count ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-pine-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-400">
              Super admin
            </span>
            <span className="text-xs text-slate-400">Platform overview</span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-slate-500">Every account, website and build on Dukan Builder.</p>
        </div>
      </div>

      <div className="mt-6">
        <KpiSection statsByRange={statsByRange} asOf={asOf} />
      </div>

      {failureGroups.length > 0 && (
        <Card className="mt-6 border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-red-800">
                {failureGroups.reduce((a, g) => a + g.count, 0)} failed build{failureGroups.length === 1 ? "" : "s"} in the last 7 days:
              </span>
              {failedGroups.map((g) => (
                <Link
                  key={g.reason}
                  href={`/admin/builds?status=failed&reason=${g.reason}`}
                  className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:border-red-400"
                >
                  {g.label}: {g.count}
                </Link>
              ))}
              {unknownCount > 0 && (
                <Link
                  href="/admin/builds?status=failed&reason=unknown"
                  className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:border-red-400"
                >
                  Unknown: {unknownCount}
                </Link>
              )}
              <Link href="/admin/builds?status=failed" className="ml-auto text-xs font-semibold text-red-800 hover:underline">
                View all failed →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold">Users</h2>
            <p className="mt-0.5 text-xs text-slate-400">Click a user to see every site and build they own.</p>
          </div>
          <Link href="/admin/users" className="text-xs font-semibold text-pine-800 hover:underline">
            All users →
          </Link>
        </div>
        <DataTable
          {...toTable(userColumns, users.slice(0, 10), { key: (r) => r.id, search: (r) => r.email })}
          defaultPageSize={5}
          pageSizes={[5, 10]}
        />
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold">Websites</h2>
            <p className="mt-0.5 text-xs text-slate-400">All sites across all accounts, newest first.</p>
          </div>
          <Link href="/admin/websites" className="text-xs font-semibold text-pine-800 hover:underline">
            All websites →
          </Link>
        </div>
        <DataTable
          {...toTable(siteColumns, sites.slice(0, 10), {
            key: (r) => r.id,
            search: (r) => `${r.business_name} ${r.slug} ${r.owner_email}`,
          })}
          defaultPageSize={5}
          pageSizes={[5, 10]}
        />
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold">Recent builds</h2>
            <p className="mt-0.5 text-xs text-slate-400">Latest 20 builds across the platform — open one to read its full log.</p>
          </div>
          <Link href="/admin/builds" className="text-xs font-semibold text-pine-800 hover:underline">
            All builds →
          </Link>
        </div>
        <DataTable
          {...toTable(buildColumns, builds, {
            key: (r) => r.id,
            search: (r) => `${r.business_name} ${r.owner_email}`,
          })}
          defaultPageSize={10}
          pageSizes={[10, 20]}
        />
      </Card>
    </div>
  );
}
