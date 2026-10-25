import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, CircleCheck, KeyRound, ShieldMinus, ShieldPlus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { FormAction } from "@/components/admin/form-action";
import { AdminBadge, BuildStatusBadge, SiteStatusBadge, UserStatusBadge } from "@/components/admin/badges";
import { QuotaBar } from "@/components/admin/quota-bar";
import { requireAdmin } from "@/lib/auth";
import { getAdminUser, listBuildsForUser, listSitesForUser, listUserActivity, type AdminBuildRow, type AdminSiteRow } from "@/lib/admin";
import { deleteUser, reactivateUser, resetUserPassword, setUserQuota, setUserRole, suspendUser } from "@/lib/admin-actions";
import { formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [user, sites, builds, activity] = await Promise.all([
    getAdminUser(id),
    listSitesForUser(id),
    listBuildsForUser(id),
    listUserActivity(id),
  ]);
  if (!user) notFound();

  async function suspend(fd: FormData) {
    "use server";
    return suspendUser(admin, id, String(fd.get("reason") ?? ""));
  }
  async function reactivate(fd: FormData) {
    "use server";
    return reactivateUser(admin, id, String(fd.get("reason") ?? ""));
  }
  async function makeAdmin(fd: FormData) {
    "use server";
    return setUserRole(admin, id, true, String(fd.get("reason") ?? ""));
  }
  async function removeAdmin(fd: FormData) {
    "use server";
    return setUserRole(admin, id, false, String(fd.get("reason") ?? ""));
  }
  async function setQuota(fd: FormData) {
    "use server";
    return setUserQuota(admin, id, Number(fd.get("quota")), String(fd.get("reason") ?? ""));
  }
  async function resetPassword(fd: FormData) {
    "use server";
    return resetUserPassword(admin, id, String(fd.get("password") ?? ""), String(fd.get("reason") ?? ""));
  }
  async function remove(fd: FormData) {
    "use server";
    return deleteUser(admin, id, String(fd.get("reason") ?? ""));
  }

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
    { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, render: (r) => <SiteStatusBadge status={r.status} /> },
    { key: "category", header: "Category", sortable: true, sortValue: (r) => r.category, render: (r) => <span className="capitalize text-slate-600">{r.category}</span>, hideBelow: "md" },
    { key: "created", header: "Created", sortable: true, sortValue: (r) => r.created_at, render: (r) => relativeTime(r.created_at), hideBelow: "md" },
  ];

  const buildColumns: AdminColumn<AdminBuildRow>[] = [
    {
      key: "site",
      header: "Website",
      sortable: true,
      sortValue: (r) => r.business_name,
      render: (r) => (
        <Link href={`/admin/builds/${r.id}`} className="font-medium text-slate-900 hover:underline">
          {r.business_name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <BuildStatusBadge status={r.status} />
        </span>
      ),
    },
    { key: "kind", header: "Type", sortable: true, sortValue: (r) => r.kind, render: (r) => <span className="text-xs capitalize text-slate-500">{r.kind}</span>, hideBelow: "md" },
    {
      key: "created",
      header: "When",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => <span title={formatDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>,
    },
  ];

  const isSuspended = user.status === "suspended";

  return (
    <div>
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All users
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{user.email}</h1>
            <AdminBadge isAdmin={user.is_admin} />
            <UserStatusBadge status={user.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Joined {formatDateTime(user.created_at)} · last build {user.last_build_at ? relativeTime(user.last_build_at) : "never"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSuspended ? (
            <ConfirmAction
              label={<><CircleCheck data-icon="inline-start" aria-hidden="true" /> Reactivate</>}
              title="Reactivate this user?"
              description="They will be able to sign in and build again."
              confirmLabel="Reactivate user"
              action={reactivate}
              requireReason
              variant="outline"
              tone="default"
            />
          ) : (
            <ConfirmAction
              label={<><Ban data-icon="inline-start" aria-hidden="true" /> Suspend</>}
              title="Suspend this user?"
              description="They will be signed out and blocked from signing in until reactivated."
              confirmLabel="Suspend user"
              action={suspend}
              requireReason
            />
          )}
          {user.is_admin === 1 ? (
            <ConfirmAction
              label={<><ShieldMinus data-icon="inline-start" aria-hidden="true" /> Remove admin</>}
              title="Remove admin role?"
              description="They keep their account and websites but lose access to the admin dashboard."
              confirmLabel="Remove admin"
              action={removeAdmin}
              requireReason
              variant="outline"
              tone="default"
            />
          ) : (
            <ConfirmAction
              label={<><ShieldPlus data-icon="inline-start" aria-hidden="true" /> Make admin</>}
              title="Make this user a super admin?"
              description="They will gain full access to every section of the admin dashboard, including destructive actions."
              confirmLabel="Make admin"
              action={makeAdmin}
              requireReason
              variant="outline"
              tone="default"
            />
          )}
          <FormAction
            label={<><SlidersHorizontal data-icon="inline-start" aria-hidden="true" /> Quota</>}
            title="Adjust build quota"
            description="How many builds this user may run in total. Existing usage is kept."
            confirmLabel="Save quota"
            action={setQuota}
            field={{ name: "quota", label: "Builds allowed", type: "number", min: 0, max: 1000, placeholder: String(user.builds_allowed) }}
            requireReason
            variant="outline"
          />
          <FormAction
            label={<><KeyRound data-icon="inline-start" aria-hidden="true" /> Reset password</>}
            title="Set a temporary password"
            description="The user will need this password to sign in and should change it immediately. Min 10 characters."
            confirmLabel="Set password"
            action={resetPassword}
            field={{ name: "password", label: "Temporary password", type: "password", placeholder: "••••••••••", hint: "Give this to the user over a secure channel." }}
            requireReason
            variant="outline"
          />
          <ConfirmAction
            label={<><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete</>}
            title="Delete this user and everything they own?"
            description={
              <>
                This permanently deletes their account, all websites, builds, chat messages and published files.
                There is no undo.
              </>
            }
            confirmLabel="Delete user"
            action={remove}
            requireReason
            reasonPlaceholder="Why is this user being deleted?"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sites</div>
            <div className="mt-1 font-display text-2xl font-bold">{user.sites}</div>
            <div className="text-xs text-slate-400">{user.published} published</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Builds</div>
            <div className="mt-1 font-display text-2xl font-bold">{user.builds}</div>
            <div className="text-xs text-slate-400">last {relativeTime(user.last_build_at)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quota</div>
            <div className="mt-2">
              <QuotaBar used={user.builds_used} allowed={user.builds_allowed} className="w-full" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Role</div>
            <div className="mt-1 font-display text-2xl font-bold">{user.is_admin ? "Admin" : "User"}</div>
            <div className="text-xs text-slate-400">{isSuspended ? "Suspended" : "Active"}</div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100">
              <CardTitle>Websites</CardTitle>
            </CardHeader>
            <DataTable
              {...toTable(siteColumns, sites, {
                key: (r) => r.id,
                search: (r) => r.business_name,
              })}
              defaultPageSize={5}
              pageSizes={[5, 10, 25]}
              emptyTitle="No websites yet"
              emptyDescription="This user has not created a website."
            />
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100">
              <CardTitle>Builds</CardTitle>
            </CardHeader>
            <DataTable
              {...toTable(buildColumns, builds, {
                key: (r) => r.id,
                search: (r) => r.business_name,
              })}
              defaultPageSize={5}
              pageSizes={[5, 10, 25]}
              emptyTitle="No builds yet"
              emptyDescription="This user has not run a build."
            />
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activity.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-400">No activity recorded.</p>
            ) : (
              <ol className="max-h-96 overflow-auto px-6 pb-4">
                {activity.map((e, i) => (
                  <li key={i} className="relative border-l border-slate-200 pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-1 top-1.5 size-2 rounded-full bg-pine-700" aria-hidden="true" />
                    <div className="text-xs text-slate-400">{relativeTime(e.at)}</div>
                    <div className="text-sm text-slate-700">{e.text}</div>
                    {e.href && (
                      <Link href={e.href} className="text-xs font-medium text-pine-800 hover:underline">
                        View →
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
