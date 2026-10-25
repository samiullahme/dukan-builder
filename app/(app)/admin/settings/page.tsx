import { UserRoundCog, UserRoundX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { FormAction } from "@/components/admin/form-action";
import { SettingsForm } from "@/components/admin/settings-form";
import { getPlatformSettings, listAdminUsers, setPlatformSetting, writeAudit, type AdminUserRow } from "@/lib/admin";
import { addAdmin, removeAdmin } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = await requireAdmin();
  const [settings, users] = await Promise.all([getPlatformSettings(), listAdminUsers()]);
  const admins = users.filter((u) => u.is_admin === 1);

  async function saveSettings(fd: FormData) {
    "use server";
    try {
      const quota = Math.max(0, Math.min(1000, Number(fd.get("default_builds_allowed")) || 5));
      const beta = fd.get("feature_beta_builds") === "1";
      const banner = String(fd.get("announcement_banner") ?? "");
      const words = String(fd.get("banned_words") ?? "")
        .split(/[\n,]+/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      await setPlatformSetting("default_builds_allowed", quota, admin.id);
      await setPlatformSetting("feature_beta_builds", beta, admin.id);
      await setPlatformSetting("announcement_banner", banner, admin.id);
      await setPlatformSetting("banned_words", words, admin.id);
      const changed = [
        quota !== settings.default_builds_allowed ? `default_builds_allowed=${quota}` : null,
        beta !== settings.feature_beta_builds ? `feature_beta_builds=${beta}` : null,
        banner !== settings.announcement_banner ? `announcement_banner=${banner}` : null,
        words.join(",") !== settings.banned_words.join(",") ? `banned_words=${words.join(",")}` : null,
      ].filter(Boolean);
      await writeAudit(admin, "settings.update", "platform_settings", null, changed.join("; ") || null, null);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Could not save settings." };
    }
  }

  async function add(fd: FormData) {
    "use server";
    return addAdmin(admin, String(fd.get("email") ?? ""));
  }
  async function remove(fd: FormData) {
    "use server";
    return removeAdmin(admin, String(fd.get("userId") ?? ""), String(fd.get("reason") ?? ""));
  }

  const adminColumns: AdminColumn<AdminUserRow>[] = [
    {
      key: "email",
      header: "Admin",
      sortable: true,
      sortValue: (r) => r.email,
      render: (r) => (
        <div>
          <span className="font-medium text-slate-900">{r.email}</span>
          {r.id === admin.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
          <div className="text-xs text-slate-400">admin since {relativeTime(r.created_at)}</div>
        </div>
      ),
    },
    { key: "sites", header: "Sites", sortable: true, sortValue: (r) => r.sites, render: (r) => <span className="tabular-nums">{r.sites}</span>, hideBelow: "md" },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) =>
        r.id === admin.id ? null : (
          <ConfirmAction
            label={<><UserRoundX data-icon="inline-start" aria-hidden="true" /> Remove</>}
            title="Remove this admin?"
            description="They keep their account and websites but lose access to the admin dashboard."
            confirmLabel="Remove admin"
            action={remove}
            formFields={{ userId: r.id }}
            requireReason
            variant="outline"
            tone="default"
            size="xs"
          />
        ),
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
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-slate-500">Platform defaults, feature flags and super admins.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SettingsForm initial={settings} action={saveSettings} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between border-b border-slate-100">
              <CardTitle>Super admins</CardTitle>
              <FormAction
                label={<><UserRoundCog data-icon="inline-start" aria-hidden="true" /> Add admin</>}
                title="Add a super admin"
                description="The user must already have an account. They gain full access to every admin section."
                confirmLabel="Add admin"
                action={add}
                field={{ name: "email", label: "Email", type: "text", placeholder: "user@example.com" }}
                requireReason
                variant="outline"
                size="xs"
              />
            </CardHeader>
            <DataTable
              {...toTable(adminColumns, admins, {
                key: (r) => r.id,
                search: (r) => r.email,
              })}
              defaultPageSize={5}
              pageSizes={[5, 10]}
              emptyTitle="No admins"
              emptyDescription="Add the first super admin above."
            />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About this release</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              <p>
                Every destructive action requires a reason and is written to the{" "}
                <a href="/admin/audit" className="font-medium text-pine-800 hover:underline">audit log</a>. Hard-deleting a
                user or website removes its files from disk as well as its database rows.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
