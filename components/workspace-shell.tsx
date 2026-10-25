"use client";

import { usePathname } from "next/navigation";
import { Logo } from "./ui";
import { logout } from "@/lib/auth-actions";

type ShellUser = { email: string; is_admin: number };

export function WorkspaceShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const initial = (user.email || "?").trim().charAt(0).toUpperCase();

  // The dashboard and the new-site wizard render their own shells.
  if (pathname === "/dashboard" || pathname.startsWith("/sites/new")) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="flex items-center gap-1">
              <a
                href="/dashboard"
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900"
              >
                My Websites
              </a>
              {user.is_admin === 1 && (
                <a
                  href="/admin"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Admin
                </a>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/sites/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden sm:inline">New Website</span>
              <span className="sm:hidden">New</span>
            </a>
            <span className="hidden max-w-[180px] truncate text-sm text-slate-400 lg:block" title={user.email}>
              {user.email}
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-white" title={user.email}>
              {initial}
            </span>
            <form action={logout}>
              <button
                type="submit"
                title="Log out"
                className="cursor-pointer rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
