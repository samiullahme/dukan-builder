import { Badge } from "@/components/ui/badge";
import { FAILURE_LABELS, type FailureReason } from "@/lib/failures";
import { cn } from "@/lib/utils";

export function SiteStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    draft: { label: "Draft", tone: "bg-slate-100 text-slate-600" },
    building: { label: "Building", tone: "bg-sky-100 text-sky-700" },
    ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-700" },
    published: { label: "Published", tone: "bg-gold-100 text-pine-900" },
    failed: { label: "Failed", tone: "bg-red-100 text-red-700" },
  };
  const m = map[status] ?? { label: status, tone: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={cn("border-transparent font-semibold", m.tone)}>{m.label}</Badge>;
}

export function BuildStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    queued: { label: "Queued", tone: "bg-slate-100 text-slate-600" },
    building: { label: "Building", tone: "bg-sky-100 text-sky-700" },
    ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-700" },
    failed: { label: "Failed", tone: "bg-red-100 text-red-700" },
    cancelled: { label: "Cancelled", tone: "bg-slate-200 text-slate-600" },
  };
  const m = map[status] ?? { label: status, tone: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={cn("border-transparent font-semibold", m.tone)}>{m.label}</Badge>;
}

export function FailureBadge({ reason }: { reason: FailureReason | null | string }) {
  if (!reason) return <span className="text-slate-300">—</span>;
  const label = FAILURE_LABELS[reason as FailureReason] ?? reason;
  return (
    <Badge variant="outline" className="border-red-200 bg-red-50 font-semibold text-red-700">
      {label}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: string | null }) {
  if (!kind) return <span className="text-slate-300">—</span>;
  return kind === "refine" ? (
    <Badge variant="outline" className="border-transparent bg-sky-100 font-semibold text-sky-700">Refine</Badge>
  ) : (
    <Badge variant="outline" className="border-transparent bg-pine-100 font-semibold text-pine-800">Initial</Badge>
  );
}

export function ReviewedBadge({ reviewed }: { reviewed: number }) {
  return reviewed ? (
    <Badge variant="outline" className="border-transparent bg-emerald-100 font-semibold text-emerald-700">Reviewed</Badge>
  ) : (
    <span className="text-xs text-slate-400">Not reviewed</span>
  );
}

export function AdminBadge({ isAdmin }: { isAdmin: number }) {
  return isAdmin ? (
    <Badge variant="outline" className="border-transparent bg-pine-900 font-semibold text-gold-400">Admin</Badge>
  ) : null;
}

export function UserStatusBadge({ status }: { status: string }) {
  return status === "suspended" ? (
    <Badge variant="outline" className="border-transparent bg-red-100 font-semibold text-red-700">Suspended</Badge>
  ) : (
    <Badge variant="outline" className="border-transparent bg-emerald-100 font-semibold text-emerald-700">Active</Badge>
  );
}
