"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminBuildRow, AdminSiteRow, AdminUserRow } from "@/lib/admin";
import { getCategory } from "@/lib/categories";
import { formatDateTime, formatDuration, lastLogLine, relativeTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui";

const FILTER_INPUT =
  "w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-[13px] text-stone-900 placeholder:text-stone-400 shadow-sm transition focus:border-pine-600 focus:outline-none focus:ring-2 focus:ring-pine-600/20";
const FILTER_SELECT =
  "w-auto rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-700 shadow-sm transition focus:border-pine-600 focus:outline-none focus:ring-2 focus:ring-pine-600/20";

const AVATAR_COLORS = [
  "bg-pine-100 text-pine-800",
  "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
];

function avatarColor(email: string): string {
  return AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length];
}

function Time({ value, now }: { value: string | null; now: number }) {
  if (!value) return <span className="text-stone-300">—</span>;
  return (
    <time dateTime={value.replace(" ", "T") + "Z"} title={formatDateTime(value)} className="whitespace-nowrap">
      {relativeTime(value, now)}
    </time>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border-b border-stone-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-b border-stone-100 px-5 py-3.5 align-middle ${className}`}>{children}</td>;
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-sm text-stone-400">
        {message}
      </td>
    </tr>
  );
}

function FilterBar({
  query,
  onQuery,
  placeholder,
  children,
}: {
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-5 py-3">
      <div className="relative min-w-[220px] flex-1">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className={FILTER_INPUT}
          aria-label={placeholder}
        />
      </div>
      {children}
    </div>
  );
}

function Footer({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  return (
    <div className="px-5 py-3 text-xs text-stone-400">
      Showing {shown} of {total} {noun}
    </div>
  );
}

export function UsersTable({ rows, now }: { rows: AdminUserRow[]; now: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.email.toLowerCase().includes(q)) return false;
      if (filter === "admins" && r.is_admin !== 1) return false;
      if (filter === "with-sites" && r.sites === 0) return false;
      if (filter === "no-sites" && r.sites > 0) return false;
      return true;
    });
  }, [rows, query, filter]);

  return (
    <div>
      <FilterBar query={query} onQuery={setQuery} placeholder="Search by email…">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={FILTER_SELECT} aria-label="Filter users">
          <option value="all">All users</option>
          <option value="admins">Admins</option>
          <option value="with-sites">Has websites</option>
          <option value="no-sites">No websites</option>
        </select>
      </FilterBar>
      <TableShell>
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Joined</Th>
            <Th className="hidden md:table-cell">Websites</Th>
            <Th className="hidden sm:table-cell">Builds</Th>
            <Th className="hidden lg:table-cell">Last build</Th>
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && <EmptyRow colSpan={6} message="No users match this search." />}
          {filtered.map((u) => (
            <tr key={u.id} className="group transition-colors hover:bg-stone-50/70">
              <Td>
                <div className="flex items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold uppercase ${avatarColor(u.email)}`}>
                    {u.email[0]}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/users/${u.id}`} className="truncate font-medium text-stone-900 hover:text-pine-800 hover:underline">
                        {u.email}
                      </Link>
                      {u.is_admin === 1 && (
                        <span className="rounded-full bg-pine-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-400">
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-stone-400">Joined {formatDateTime(u.created_at)}</p>
                  </div>
                </div>
              </Td>
              <Td className="whitespace-nowrap text-stone-500">
                <Time value={u.created_at} now={now} />
              </Td>
              <Td className="hidden md:table-cell">
                {u.sites === 0 ? (
                  <span className="text-stone-300">None</span>
                ) : (
                  <span className="text-stone-700">
                    {u.sites} <span className="text-xs text-stone-400">· {u.published} live</span>
                  </span>
                )}
              </Td>
              <Td className="hidden sm:table-cell whitespace-nowrap">
                <span className="text-stone-700">{u.builds_used}</span>
                <span className="text-xs text-stone-400"> / {u.builds_allowed}</span>
                <span className="ml-2 text-[11px] uppercase tracking-wide text-stone-400">{u.builds} total</span>
              </Td>
              <Td className="hidden lg:table-cell whitespace-nowrap text-stone-500">
                <Time value={u.last_build_at} now={now} />
              </Td>
              <Td>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-stone-300 transition group-hover:bg-white group-hover:text-stone-600"
                  aria-label={`Open ${u.email}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Footer shown={filtered.length} total={rows.length} noun="users" />
    </div>
  );
}

const SITE_FILTERS = ["all", "published", "ready", "draft", "failed"];

export function SitesTable({ rows, now, showOwner = true }: { rows: AdminSiteRow[]; now: number; showOwner?: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.business_name} ${r.slug} ${r.owner_email}`.toLowerCase().includes(q)) return false;
      if (filter !== "all" && r.status !== filter) return false;
      return true;
    });
  }, [rows, query, filter]);

  return (
    <div>
      <FilterBar query={query} onQuery={setQuery} placeholder="Search site, slug or owner…">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={FILTER_SELECT} aria-label="Filter websites">
          {SITE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </FilterBar>
      <TableShell>
        <thead>
          <tr>
            <Th>Website</Th>
            {showOwner && <Th className="hidden md:table-cell">Owner</Th>}
            <Th className="hidden lg:table-cell">Category</Th>
            <Th>Status</Th>
            <Th className="hidden sm:table-cell">Last build</Th>
            <Th className="hidden lg:table-cell">Created</Th>
            <Th className="w-16">Open</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && <EmptyRow colSpan={showOwner ? 7 : 6} message="No websites match this search." />}
          {filtered.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-stone-50/70">
              <Td>
                <p className="font-medium text-stone-900">{s.business_name}</p>
                <p className="mt-0.5 font-mono text-xs text-stone-400">{s.slug}.dukanbot.website</p>
              </Td>
              {showOwner && (
                <Td className="hidden md:table-cell">
                  <Link href={`/admin/users/${s.owner_id}`} className="text-stone-600 hover:text-pine-800 hover:underline">
                    {s.owner_email}
                  </Link>
                </Td>
              )}
              <Td className="hidden lg:table-cell text-stone-500">{getCategory(s.category).label}</Td>
              <Td>
                <StatusBadge status={s.status} />
              </Td>
              <Td className="hidden sm:table-cell whitespace-nowrap">
                <div className="flex items-center gap-2">
                  {s.last_build_status ? <StatusBadge status={s.last_build_status} /> : <span className="text-stone-300">—</span>}
                  {s.last_build_at && (
                    <span className="text-xs text-stone-400">
                      <Time value={s.last_build_at} now={now} />
                    </span>
                  )}
                </div>
              </Td>
              <Td className="hidden lg:table-cell whitespace-nowrap text-stone-500">
                <Time value={s.created_at} now={now} />
              </Td>
              <Td>
                {s.status === "published" ? (
                  <a
                    href={`https://${s.slug}.dukanbot.website`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-pine-800 hover:underline"
                  >
                    Visit
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7M7 7h10v10" />
                    </svg>
                  </a>
                ) : (
                  <span className="text-xs text-stone-300">Not live</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Footer shown={filtered.length} total={rows.length} noun="websites" />
    </div>
  );
}

const BUILD_FILTERS = ["all", "ready", "failed", "building", "queued"];

export function BuildsTable({ rows, now }: { rows: AdminBuildRow[]; now: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.business_name} ${r.owner_email}`.toLowerCase().includes(q)) return false;
      if (filter !== "all" && r.status !== filter) return false;
      return true;
    });
  }, [rows, query, filter]);

  return (
    <div>
      <FilterBar query={query} onQuery={setQuery} placeholder="Search build by site or owner…">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={FILTER_SELECT} aria-label="Filter builds">
          {BUILD_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </FilterBar>
      <TableShell>
        <thead>
          <tr>
            <Th>Website</Th>
            <Th className="hidden md:table-cell">Owner</Th>
            <Th>Status</Th>
            <Th className="hidden sm:table-cell">Started</Th>
            <Th className="hidden lg:table-cell">Duration</Th>
            <Th>Last log line</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && <EmptyRow colSpan={6} message="No builds match this search." />}
          {filtered.map((b) => {
            const line = lastLogLine(b.log);
            return (
              <tr key={b.id} className="transition-colors hover:bg-stone-50/70">
                <Td>
                  <p className="font-medium text-stone-900">{b.business_name}</p>
                  <p className="mt-0.5 font-mono text-xs text-stone-400">{b.slug}</p>
                </Td>
                <Td className="hidden md:table-cell text-stone-500">{b.owner_email}</Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                <Td className="hidden sm:table-cell whitespace-nowrap text-stone-500">
                  <Time value={b.started_at || b.created_at} now={now} />
                </Td>
                <Td className="hidden lg:table-cell whitespace-nowrap text-stone-500">
                  {formatDuration(b.started_at, b.finished_at)}
                </Td>
                <Td className="max-w-[320px]">
                  <p className="truncate text-xs text-stone-500" title={line || undefined}>
                    {line || <span className="text-stone-300">No log output</span>}
                  </p>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      <Footer shown={filtered.length} total={rows.length} noun="builds" />
    </div>
  );
}
