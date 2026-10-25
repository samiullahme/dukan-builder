import Link from "next/link";
import type { ReactNode } from "react";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l1.5-5h15L21 9" />
          <path d="M3 9h18v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
          <path d="M5 14v7M19 14v7M9 14v4M15 14v4" />
        </svg>
      </span>
      <span className={`text-xl font-bold tracking-tight ${dark ? "text-white" : "text-foreground"}`}>
        Dukan<span className="text-emerald-600">Builder</span>
      </span>
    </Link>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "success";
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
  const styles = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:bg-slate-800 hover:shadow active:scale-[0.98]",
    secondary:
      "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]",
    success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:shadow active:scale-[0.98]",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "success";
  className?: string;
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all";
  const styles = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:bg-slate-800 hover:shadow",
    secondary: "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50",
    success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:shadow",
  }[variant];
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_0_rgba(15,23,42,0.03),0_1px_2px_-1px_rgba(15,23,42,0.03)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} min-h-[110px] resize-y ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  queued: "bg-amber-50 text-amber-700",
  building: "bg-amber-50 text-amber-700",
  ready: "bg-emerald-50 text-emerald-700",
  published: "bg-blue-50 text-blue-700",
  failed: "bg-red-50 text-red-600",
};

export function StatusBadge({ status }: { status: string }) {
  const pulse = status === "building" || status === "queued";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>
      )}
      {status}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
