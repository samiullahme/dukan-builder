import { ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/admin/data-table";
import { toTable, type AdminColumn } from "@/lib/table";
import { listAudit, type AuditRow } from "@/lib/admin";
import { formatDateTime, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const rows = await listAudit(500);

  const columns: AdminColumn<AuditRow>[] = [
    {
      key: "when",
      header: "When",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => <span title={formatDateTime(r.created_at)}>{relativeTime(r.created_at)}</span>,
    },
    {
      key: "actor",
      header: "Actor",
      sortable: true,
      sortValue: (r) => r.actor_email ?? "",
      render: (r) => <span className="text-sm text-slate-700">{r.actor_email ?? "system"}</span>,
      hideBelow: "sm",
    },
    { key: "action", header: "Action", sortable: true, sortValue: (r) => r.action, render: (r) => <span className="font-mono text-xs text-slate-700">{r.action}</span> },
    {
      key: "target",
      header: "Target",
      sortable: true,
      sortValue: (r) => `${r.target_type ?? ""} ${r.target_id ?? ""}`,
      render: (r) => (
        <span className="text-xs text-slate-500">
          {r.target_type ? `${r.target_type} ${r.target_id ? r.target_id.slice(0, 8) : ""}` : "—"}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "reason",
      header: "Reason",
      sortable: false,
      render: (r) => <span className="block max-w-72 truncate text-xs text-slate-500" title={r.reason ?? ""}>{r.reason || "—"}</span>,
      hideBelow: "lg",
    },
    { key: "ip", header: "IP", sortable: false, render: (r) => <span className="font-mono text-xs text-slate-400">{r.ip ?? "—"}</span>, hideBelow: "lg" },
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
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Audit log</h1>
          <p className="mt-1 text-slate-500">Every admin action, who did it and why.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <ScrollText className="size-4" aria-hidden="true" />
          last 500 entries
        </span>
      </div>

      <Card className="mt-6 overflow-hidden">
        <DataTable
          {...toTable(columns, rows, {
            key: (r) => r.id,
            search: (r) => `${r.actor_email ?? ""} ${r.action} ${r.target_type ?? ""} ${r.target_id ?? ""} ${r.reason ?? ""}`,
            csv: (r) => ({
              when: r.created_at,
              actor: r.actor_email ?? "",
              action: r.action,
              target_type: r.target_type ?? "",
              target_id: r.target_id ?? "",
              reason: r.reason ?? "",
              ip: r.ip ?? "",
            }),
          })}
          searchPlaceholder="Search actions, actors, targets or reasons…"
          csvName="dukan-audit-log"
          emptyTitle="No audit entries"
          emptyDescription="Admin actions will show up here."
        />
      </Card>
    </div>
  );
}
