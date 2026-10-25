import Link from "next/link";
import { Flag, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { listAdminSites, listSiteFlags, getPlatformSettings, type SiteFlagRow, type AdminSiteRow } from "@/lib/admin";
import { resolveSiteFlag } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminModerationPage() {
  const admin = await requireAdmin();
  const [flags, recentSites, settings] = await Promise.all([
    listSiteFlags(),
    listAdminSites().then((s) => s.slice(0, 20)),
    getPlatformSettings(),
  ]);

  async function resolveDismiss(fd: FormData) {
    "use server";
    return resolveSiteFlag(admin, String(fd.get("flagId") ?? ""), "dismiss");
  }
  async function resolveUnpublish(fd: FormData) {
    "use server";
    return resolveSiteFlag(admin, String(fd.get("flagId") ?? ""), "unpublish");
  }
  async function resolveDelete(fd: FormData) {
    "use server";
    return resolveSiteFlag(admin, String(fd.get("flagId") ?? ""), "delete");
  }

  const flagColumns: AdminColumn<SiteFlagRow>[] = [
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
          <div className="text-xs text-slate-400">{r.slug}.dukanbot.website</div>
        </div>
      ),
    },
    { key: "reason", header: "Reason", sortable: true, sortValue: (r) => r.reason, render: (r) => <span className="text-sm text-slate-600">{r.reason}</span> },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <Badge
          variant="outline"
          className={
            r.status === "open"
              ? "border-transparent bg-amber-100 font-semibold text-amber-800"
              : "border-transparent bg-slate-100 font-semibold text-slate-500"
          }
        >
          {r.status === "open" ? "Open" : "Resolved"}
        </Badge>
      ),
    },
    { key: "when", header: "Reported", sortable: true, sortValue: (r) => r.created_at, render: (r) => relativeTime(r.created_at), hideBelow: "md" },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (r) =>
        r.status === "open" ? (
          <span className="flex flex-wrap gap-1.5">
            <ConfirmAction
              label={<><ShieldCheck data-icon="inline-start" aria-hidden="true" /> Dismiss</>}
              title="Dismiss this report?"
              description="The flag is closed and the website stays online."
              confirmLabel="Dismiss"
              action={resolveDismiss}
              formFields={{ flagId: r.id }}
              variant="outline"
              tone="default"
              size="xs"
            />
            <ConfirmAction
              label={<><XCircle data-icon="inline-start" aria-hidden="true" /> Unpublish</>}
              title="Unpublish this website?"
              description="The flagged website is taken offline immediately."
              confirmLabel="Unpublish"
              action={resolveUnpublish}
              formFields={{ flagId: r.id }}
              requireReason
              size="xs"
              variant="outline"
              tone="default"
            />
            <ConfirmAction
              label={<><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete</>}
              title="Delete this website?"
              description="The flagged website and all its data are permanently deleted."
              confirmLabel="Delete website"
              action={resolveDelete}
              formFields={{ flagId: r.id }}
              requireReason
              size="xs"
            />
          </span>
        ) : (
          <span className="text-xs text-slate-400">Resolved</span>
        ),
    },
  ];

  const queueColumns: AdminColumn<AdminSiteRow>[] = [
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
          <div className="text-xs text-slate-400">{r.owner_email}</div>
        </div>
      ),
    },
    { key: "category", header: "Category", sortable: true, sortValue: (r) => r.category, render: (r) => <span className="capitalize text-slate-600">{r.category}</span>, hideBelow: "md" },
    { key: "created", header: "Created", sortable: true, sortValue: (r) => r.created_at, render: (r) => relativeTime(r.created_at) },
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
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Moderation</h1>
          <p className="mt-1 text-slate-500">Reported websites, the review queue and banned words.</p>
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Reported websites</CardTitle>
        </CardHeader>
        <DataTable
          {...toTable(flagColumns, flags, {
            key: (r) => r.id,
            search: (r) => `${r.business_name} ${r.slug} ${r.reason}`,
          })}
          searchPlaceholder="Search reports…"
          defaultPageSize={10}
          emptyTitle="No reports"
          emptyDescription="Nobody has reported a website yet."
        />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="border-b border-slate-100">
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <DataTable
            {...toTable(queueColumns, recentSites, {
              key: (r) => r.id,
              search: (r) => `${r.business_name} ${r.owner_email}`,
            })}
            defaultPageSize={10}
            emptyTitle="Queue is empty"
            emptyDescription="No new websites to review."
          />
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="size-4" aria-hidden="true" />
              Banned words
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settings.banned_words.length === 0 ? (
              <p className="text-sm text-slate-400">No banned words configured.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {settings.banned_words.map((w) => (
                  <Badge key={w} variant="outline" className="border-transparent bg-red-50 font-medium text-red-700">
                    {w}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Edit the list in <Link href="/admin/settings" className="font-medium text-pine-800 hover:underline">Settings</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
