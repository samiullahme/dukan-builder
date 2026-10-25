import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { AdminBadge, UserStatusBadge } from "@/components/admin/badges";
import { QuotaBar } from "@/components/admin/quota-bar";
import { listAdminUsers, type AdminUserRow } from "@/lib/admin";
import { formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ role?: string; status?: string; empty?: string }> }) {
  const { role, status, empty } = await searchParams;
  const users = listAdminUsers().then((all) =>
    all.filter(
      (u) =>
        (!role || (role === "admin" ? u.is_admin === 1 : u.is_admin === 0)) &&
        (!status || u.status === status) &&
        (!empty || u.builds === 0)
    )
  );

  const columns: AdminColumn<AdminUserRow>[] = [
    {
      key: "email",
      header: "User",
      sortable: true,
      sortValue: (r) => r.email,
      render: (r) => (
        <div>
          <Link href={`/admin/users/${r.id}`} className="font-medium text-slate-900 hover:underline">
            {r.email}
          </Link>
          <div className="text-xs text-slate-400">joined {relativeTime(r.created_at)}</div>
        </div>
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
      hideBelow: "md",
    },
    {
      key: "last_build",
      header: "Last build",
      sortable: true,
      sortValue: (r) => r.last_build_at ?? "",
      render: (r) => <span title={formatDateTime(r.last_build_at)}>{relativeTime(r.last_build_at)}</span>,
      hideBelow: "lg",
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-pine-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-400">
              Super admin
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-slate-500">Every account, its role, quota and build activity.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { label: "All", href: "/admin/users", active: !role && !status && !empty },
          { label: "Admins", href: "/admin/users?role=admin", active: role === "admin" },
          { label: "No builds yet", href: "/admin/users?empty=1", active: empty === "1" },
          { label: "Suspended", href: "/admin/users?status=suspended", active: status === "suspended" },
        ].map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className={
              f.active
                ? "rounded-full bg-pine-900 px-3 py-1.5 text-xs font-semibold text-gold-400"
                : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-pine-700 hover:text-pine-900"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <DataTable
          {...toTable(columns, await users, {
            key: (r) => r.id,
            search: (r) => r.email,
            csv: (r) => ({
              email: r.email,
              role: r.is_admin ? "admin" : "user",
              status: r.status,
              sites: r.sites,
              published: r.published,
              builds: r.builds,
              builds_used: r.builds_used,
              builds_allowed: r.builds_allowed,
              joined: r.created_at,
              last_build: r.last_build_at ?? "",
            }),
          })}
          searchPlaceholder="Search by email…"
          csvName="dukan-users"
          emptyTitle="No users found"
          emptyDescription="Try a different search or clear the filters."
        />
      </Card>
    </div>
  );
}
