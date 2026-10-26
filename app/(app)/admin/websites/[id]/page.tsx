import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Rocket, Trash2, UserRoundCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { FormAction } from "@/components/admin/form-action";
import { CopyButton } from "@/components/admin/copy-button";
import { BuildStatusBadge, FailureBadge, KindBadge, SiteStatusBadge } from "@/components/admin/badges";
import { get } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getAdminSite, listSiteBuilds, type AdminBuildRow } from "@/lib/admin";
import { deleteSite, republishSite, transferSite, unpublishSite } from "@/lib/admin-actions";
import { lastLogLine, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminWebsiteDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [site, builds] = await Promise.all([getAdminSite(id), listSiteBuilds(id)]);
  if (!site) notFound();

  const liveUrl = `https://${site.slug}.lanesite.pro`;

  async function unpublish(fd: FormData) {
    "use server";
    return unpublishSite(admin, id, String(fd.get("reason") ?? ""));
  }
  async function republish(fd: FormData) {
    "use server";
    return republishSite(admin, id, String(fd.get("reason") ?? ""));
  }
  async function transfer(fd: FormData) {
    "use server";
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const target = await get<{ id: string }>("SELECT id FROM profiles WHERE email = ?", email);
    if (!target) return { ok: false, error: "No user with that email." };
    return transferSite(admin, id, target.id, String(fd.get("reason") ?? ""));
  }
  async function remove(fd: FormData) {
    "use server";
    return deleteSite(admin, id, String(fd.get("reason") ?? ""));
  }

  const buildColumns: AdminColumn<AdminBuildRow>[] = [
    {
      key: "when",
      header: "Version",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => (
        <Link href={`/admin/builds/${r.id}`} className="font-medium text-slate-900 hover:underline">
          {relativeTime(r.created_at)}
        </Link>
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
      key: "input",
      header: "Input",
      sortable: false,
      render: (r) => <span className="block max-w-56 truncate text-xs text-slate-500" title={r.input ?? ""}>{r.input || "—"}</span>,
      hideBelow: "md",
    },
    {
      key: "last_line",
      header: "Last log line",
      sortable: false,
      render: (r) => <span className="block max-w-64 truncate font-mono text-xs text-slate-500">{lastLogLine(r.log)}</span>,
      hideBelow: "lg",
    },
  ];

  return (
    <div>
      <Link href="/admin/websites" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All websites
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{site.business_name}</h1>
            <SiteStatusBadge status={site.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Owner:{" "}
            <Link href={`/admin/users/${site.owner_id}`} className="font-medium text-pine-800 hover:underline">
              {site.owner_email}
            </Link>{" "}
            · <span className="capitalize">{site.category}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-pine-900 px-3.5 text-sm font-semibold text-gold-400 transition hover:bg-pine-800"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open live site
          </a>
          {site.status === "published" ? (
            <ConfirmAction
              label={<><Rocket data-icon="inline-start" aria-hidden="true" /> Unpublish</>}
              title="Unpublish this website?"
              description="The live site is taken offline immediately and the website returns to ready state."
              confirmLabel="Unpublish"
              action={unpublish}
              requireReason
              variant="outline"
              tone="default"
            />
          ) : (
            <ConfirmAction
              label={<><Globe data-icon="inline-start" aria-hidden="true" /> Publish</>}
              title="Publish this website?"
              description="The current build is copied to the live web server. This overwrites anything previously published."
              confirmLabel="Publish"
              action={republish}
              requireReason
              variant="outline"
              tone="default"
            />
          )}
          <FormAction
            label={<><UserRoundCog data-icon="inline-start" aria-hidden="true" /> Transfer</>}
            title="Transfer ownership"
            description="Move this website to another user. The site keeps its URL and builds; only the owner changes."
            confirmLabel="Transfer"
            action={transfer}
            field={{ name: "email", label: "New owner email", type: "text", placeholder: "user@example.com" }}
            requireReason
            variant="outline"
          />
          <ConfirmAction
            label={<><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete</>}
            title="Delete this website?"
            description="Permanently deletes the website, all its builds, chat messages and published files. There is no undo."
            confirmLabel="Delete website"
            action={remove}
            requireReason
            reasonPlaceholder="Why is this website being deleted?"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="lg:row-span-2">
          <CardHeader className="flex-row items-center justify-between border-b border-slate-100">
            <CardTitle>Live preview</CardTitle>
            <span className="text-xs text-slate-400">{site.status === "published" ? liveUrl : "not published"}</span>
          </CardHeader>
          <CardContent className="p-4">
            {site.status === "published" ? (
              <iframe
                src={liveUrl}
                title={`Preview of ${site.business_name}`}
                className="h-105 w-full rounded-lg border border-slate-200 bg-white"
                loading="lazy"
              />
            ) : (
              <div className="flex h-105 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-center">
                <Globe className="size-8 text-slate-300" aria-hidden="true" />
                <p className="max-w-60 text-sm text-slate-400">
                  This website is not published yet, so there is nothing to preview.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Domains</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Subdomain</div>
              <div className="mt-1 flex items-center gap-1">
                <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-pine-800 hover:underline">
                  {site.slug}.lanesite.pro
                </a>
                <CopyButton value={liveUrl} />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Custom domain</div>
              {site.custom_domain ? (
                <div className="mt-1 flex items-center gap-1">
                  <a
                    href={`https://${site.custom_domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-pine-800 hover:underline"
                  >
                    {site.custom_domain}
                  </a>
                  <CopyButton value={`https://${site.custom_domain}`} />
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-400">No custom domain connected.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              { label: "Status", value: <SiteStatusBadge status={site.status} /> },
              { label: "Category", value: <span className="capitalize">{site.category}</span> },
              { label: "Created", value: relativeTime(site.created_at) },
              { label: "Last build", value: site.last_build_at ? relativeTime(site.last_build_at) : "never" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4">
                <span className="text-slate-500">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle>Build history</CardTitle>
        </CardHeader>
        <DataTable
          {...toTable(buildColumns, builds, {
            key: (r) => r.id,
            search: (r) => r.input ?? "",
          })}
          searchPlaceholder="Search build input…"
          defaultPageSize={10}
          pageSizes={[10, 25, 50]}
          emptyTitle="No builds yet"
          emptyDescription="This website has not been built."
        />
      </Card>
    </div>
  );
}
