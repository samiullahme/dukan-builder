import Link from "next/link";
import { Globe, Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { getDomainRows, type DomainRow } from "@/lib/domains";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function DomainStatusBadge({ status, detail }: { status: DomainRow["status"]; detail: string | null }) {
  const map: Record<DomainRow["status"], { label: string; cls: string }> = {
    ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700" },
    dns_error: { label: "DNS error", cls: "bg-red-100 text-red-700" },
    down: { label: "Not answering", cls: "bg-amber-100 text-amber-800" },
    unchecked: { label: "Unchecked", cls: "bg-slate-100 text-slate-500" },
  };
  const m = map[status];
  return (
    <span title={detail ?? undefined}>
      <Badge variant="outline" className={cn("border-transparent font-semibold", m.cls)}>{m.label}</Badge>
    </span>
  );
}

export default async function AdminDomainsPage() {
  const rows = await getDomainRows();
  const broken = rows.filter((r) => r.status !== "ok").length;

  const columns: AdminColumn<DomainRow>[] = [
    {
      key: "domain",
      header: "Domain",
      sortable: true,
      sortValue: (r) => r.domain,
      render: (r) => (
        <div>
          <a
            href={`https://${r.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-900 hover:underline"
          >
            {r.domain}
          </a>
          <div className="text-xs text-slate-400">
            <Link href={`/admin/websites/${r.site_id}`} className="hover:underline">
              {r.business_name}
            </Link>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      sortable: true,
      sortValue: (r) => r.kind,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          {r.kind === "subdomain" ? <Globe className="size-3.5" aria-hidden="true" /> : <Network className="size-3.5" aria-hidden="true" />}
          {r.kind === "subdomain" ? "Subdomain" : "Custom"}
        </span>
      ),
    },
    { key: "status", header: "DNS / SSL", sortable: true, sortValue: (r) => r.status, render: (r) => <DomainStatusBadge status={r.status} detail={r.detail} /> },
    {
      key: "detail",
      header: "Detail",
      sortable: false,
      render: (r) => <span className="text-xs text-slate-500">{r.detail ?? (r.status === "ok" ? "Serving HTTPS" : "—")}</span>,
      hideBelow: "md",
    },
    {
      key: "published",
      header: "Published",
      sortable: true,
      sortValue: (r) => (r.published ? 1 : 0),
      render: (r) => (r.published ? <span className="text-xs font-semibold text-emerald-700">Yes</span> : <span className="text-xs text-slate-400">No</span>),
      hideBelow: "md",
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
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Domains &amp; hosting</h1>
          <p className="mt-1 text-slate-500">Every subdomain and custom domain, with a live DNS and HTTPS check.</p>
        </div>
        {broken > 0 && (
          <Badge variant="outline" className="border-red-200 bg-red-50 font-semibold text-red-700">
            {broken} broken domain{broken === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <Card className="mt-6 overflow-hidden">
        <DataTable
          {...toTable(columns, rows, {
            key: (r) => `${r.site_id}-${r.kind}`,
            search: (r) => `${r.domain} ${r.business_name}`,
            csv: (r) => ({ domain: r.domain, type: r.kind, website: r.business_name, status: r.status, detail: r.detail ?? "" }),
          })}
          searchPlaceholder="Search by domain or website…"
          csvName="dukan-domains"
          emptyTitle="No domains"
          emptyDescription="No published sites or custom domains yet."
        />
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Checks run on page load: DNS resolution followed by an HTTPS request. Failures here usually mean a missing
        CNAME/A record or a Caddy misconfiguration.
      </p>
    </div>
  );
}
