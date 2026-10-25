import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { SiteStatusBadge, BuildStatusBadge } from "@/components/admin/badges";
import { CopyButton } from "@/components/admin/copy-button";
import { listAdminSites, type AdminSiteRow } from "@/lib/admin";
import { CATEGORIES } from "@/lib/categories";
import { formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminWebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; owner?: string; status?: string }>;
}) {
  const { category, owner, status } = await searchParams;
  const sites = listAdminSites().then((all) =>
    all.filter(
      (s) =>
        (!category || s.category === category) &&
        (!status || s.status === status) &&
        (!owner || s.owner_email.toLowerCase().includes(owner.toLowerCase()))
    )
  );

  const columns: AdminColumn<AdminSiteRow>[] = [
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
          <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
            <span className="truncate">{r.slug}.dukanbot.website</span>
            <CopyButton value={`https://${r.slug}.dukanbot.website`} />
          </div>
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
      key: "custom_domain",
      header: "Custom domain",
      sortable: true,
      sortValue: (r) => r.custom_domain ?? "",
      render: (r) => (r.custom_domain ? <span className="text-xs font-medium text-slate-700">{r.custom_domain}</span> : <span className="text-slate-300">—</span>),
      hideBelow: "lg",
    },
    {
      key: "last_build",
      header: "Last build",
      sortable: true,
      sortValue: (r) => r.last_build_at ?? "",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5" title={formatDateTime(r.last_build_at)}>
          <BuildStatusBadge status={r.last_build_status ?? "queued"} />
          <span className="text-xs text-slate-400">{relativeTime(r.last_build_at)}</span>
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "created",
      header: "Created",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => <span title={formatDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>,
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
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Websites</h1>
          <p className="mt-1 text-slate-500">Every site across all accounts, with its owner, category and live URL.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { label: "All", href: "/admin/websites" },
          { label: "Published", href: "/admin/websites?status=published" },
          { label: "Ready", href: "/admin/websites?status=ready" },
          { label: "Building", href: "/admin/websites?status=building" },
          { label: "Draft", href: "/admin/websites?status=draft" },
          ...CATEGORIES.map((c) => ({ label: c.label, href: `/admin/websites?category=${c.key}` })),
        ].map((f) => {
          const url = new URL(f.href, "https://x");
          const fStatus = url.searchParams.get("status");
          const fCategory = url.searchParams.get("category");
          const active =
            (fStatus ? fStatus === status : !status) && (fCategory ? fCategory === category : !category);
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

      <Card className="mt-4 overflow-hidden">
        <DataTable
          {...toTable(columns, await sites, {
            key: (r) => r.id,
            search: (r) => `${r.business_name} ${r.slug} ${r.owner_email} ${r.custom_domain ?? ""}`,
            csv: (r) => ({
              business_name: r.business_name,
              slug: r.slug,
              url: `https://${r.slug}.dukanbot.website`,
              owner: r.owner_email,
              category: r.category,
              status: r.status,
              custom_domain: r.custom_domain ?? "",
              last_build_status: r.last_build_status ?? "",
              created: r.created_at,
            }),
          })}
          searchPlaceholder="Search by name, slug, owner or domain…"
          csvName="dukan-websites"
          emptyTitle="No websites found"
          emptyDescription="Try a different search or clear the filters."
        />
      </Card>
    </div>
  );
}
