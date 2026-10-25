"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth-actions";

type DashboardUser = { email: string; isAdmin: boolean };

export function DashboardShell({
  user,
  quota,
  children,
}: {
  user: DashboardUser;
  quota: { used: number; allowed: number };
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const initial = (user.email || "?").trim().charAt(0).toUpperCase();
  const rawName = user.email.split("@")[0].split(".")[0] || "Owner";
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const pct = quota.allowed > 0 ? Math.min(100, Math.round((quota.used / quota.allowed) * 100)) : 0;

  const navItem = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold transition-colors ${
      active ? "bg-[#E5F2ED] text-[#073F35]" : "text-[#59635F] hover:bg-[#F1F5F3] hover:text-[#17201E]"
    }`;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#17201E]">
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-[#E4E8E5] bg-white/95 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] text-[#17201E] hover:bg-[#F1F5F3] lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
          <a href="/dashboard" className="flex items-center gap-2.5 text-[18px] font-extrabold" aria-label="DukanBuilder">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#073F35] text-[#EFB43F]">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
                <path d="M2 7h20" />
                <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
              </svg>
            </span>
            <span>
              Dukan<span className="text-[#D99A22]">Builder</span>
            </span>
          </a>
        </div>
        <div className="flex items-center gap-2">
          {user.isAdmin && (
            <a
              href="/admin"
              title="Admin console"
              className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-[#17201E] transition hover:bg-[#F1F5F3]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </a>
          )}
          <div className="hidden items-center gap-2.5 border-l border-[#E4E8E5] pl-3 md:flex">
            <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-[#E1EEE9] text-[11px] font-bold text-[#6D7774]">
              {initial}
            </span>
            <div className="leading-tight">
              <strong className="block text-[13px] font-semibold">{name}</strong>
              <span className="block text-[11px] text-[#6D7774]">Owner</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#9DA5A2]">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Log out"
              className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] text-[#59635F] transition hover:bg-[#F1F5F3] hover:text-[#17201E]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </header>

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-[#E4E8E5] bg-white px-4 pb-6 pt-[18px] transition-transform duration-200 lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-2 flex items-center justify-between lg:hidden">
          <a href="/dashboard" className="flex items-center gap-2.5 text-[18px] font-extrabold" aria-label="DukanBuilder">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#073F35] text-[#EFB43F]">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
                <path d="M2 7h20" />
                <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
              </svg>
            </span>
            <span>
              Dukan<span className="text-[#D99A22]">Builder</span>
            </span>
          </a>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] text-[#59635F] hover:bg-[#F1F5F3]"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <nav className="grid gap-1">
          <p className="mb-1 mt-2 px-3 text-[10px] font-semibold uppercase tracking-[1.2px] text-[#9DA5A2]">Workspace</p>
          <a href="/dashboard" className={navItem(pathname === "/dashboard")}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="7" height="9" x="3" y="3" rx="1" />
              <rect width="7" height="5" x="14" y="3" rx="1" />
              <rect width="7" height="9" x="14" y="12" rx="1" />
              <rect width="7" height="5" x="3" y="16" rx="1" />
            </svg>
            <span>Overview</span>
          </a>
          <a href="/dashboard#websites" className={navItem(false)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
              <path d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
              <path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            <span>My websites</span>
          </a>
        </nav>

        <div className="mt-auto pt-4">
          <div className="rounded-[14px] border border-[#DBE6E1] p-[15px]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#0B5949] text-[#F6B948]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
              </svg>
            </span>
            <strong className="mt-2.5 block text-[13px] font-bold">Beta plan</strong>
            <p className="mb-[9px] mt-1 text-[11px] text-[#6D7774]">
              {quota.used} of {quota.allowed} AI builds used
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[#DCE7E2]">
              <div className="h-full rounded-full bg-[#0B5949]" style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
          </div>
        </div>
      </aside>

      <main className="min-h-screen pt-16 lg:pl-[280px]">
        <div className="mx-auto max-w-[1280px] px-5 pb-[60px] pt-8">{children}</div>
      </main>
    </div>
  );
}
