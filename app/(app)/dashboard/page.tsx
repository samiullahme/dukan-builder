import { DashboardShell } from "@/components/dashboard-shell";
import { SitesGrid } from "@/components/sites-grid";
import { Greeting } from "@/components/greeting";
import { requireUser } from "@/lib/auth";
import { getPlatformSettings } from "@/lib/admin";
import db from "@/lib/db";

export default async function DashboardPage() {
  const user = await requireUser();
  const [sitesRaw, quotaRaw, settings] = await Promise.all([
    db.prepare("SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC").all(user.id),
    db.prepare("SELECT builds_used, builds_allowed FROM quota WHERE user_id = ?").get(user.id),
    getPlatformSettings(),
  ]);
  const sites = sitesRaw as any[];
  const quota = quotaRaw as any;
  const used = quota?.builds_used ?? 0;
  const allowed = quota?.builds_allowed ?? settings.default_builds_allowed;
  const left = Math.max(0, allowed - used);
  const published = sites.filter((s) => s.status === "published").length;

  let requestCounts: Record<string, number> = {};
  if (sites.length > 0) {
    const rows = (await db
      .prepare(
        `SELECT site_id, COUNT(*)::int AS n FROM site_requests WHERE site_id IN (${sites
          .map(() => "?")
          .join(",")}) GROUP BY site_id`
      )
      .all(sites.map((s) => s.id))) as any[];
    for (const r of rows) requestCounts[r.site_id] = r.n;
  }

  const rawName = user.email.split("@")[0].split(".")[0] || "Owner";
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  const metrics = [
    {
      label: "Total websites",
      value: String(sites.length),
      sub: `${published} published`,
      bg: "#E4F3ED",
      fg: "#12725E",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
          <path d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
          <path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      ),
    },
    {
      label: "Monthly visitors",
      value: "—",
      sub: "Tracking coming soon",
      bg: "#EEEAFF",
      fg: "#715CC4",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
      ),
    },
    {
      label: "Build credits",
      value: `${left} left`,
      sub: `${used} of ${allowed} used`,
      bg: "#FCF0D4",
      fg: "#A96F08",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <path d="M20 3v4" />
          <path d="M22 5h-4" />
          <path d="M4 17v2" />
          <path d="M5 18H3" />
        </svg>
      ),
    },
  ];

  return (
    <DashboardShell
      user={{ email: user.email, isAdmin: user.is_admin === 1 }}
      quota={{ used, allowed }}
    >
      {settings.announcement_banner && (
        <div className="mb-6 flex items-start gap-2 rounded-[14px] border border-[#DBE6E1] bg-[#E5F2ED] px-4 py-3 text-sm text-[#073F35]">
          <span className="mr-1 shrink-0 text-[11px] font-bold uppercase tracking-wider">Announcement</span>
          <span>{settings.announcement_banner}</span>
        </div>
      )}

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-[7px] text-xs font-bold uppercase tracking-[0.96px] text-[#0B5949]">
            <Greeting name={name} />
          </p>
          <h1 className="text-[29px] font-extrabold tracking-[-1.16px]">Your websites</h1>
          <p className="text-base text-[#6D7774]">Create, manage and grow every shop from one place.</p>
        </div>
        <a
          href="/sites/new"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#0B5949] px-4 text-sm font-bold text-white transition hover:bg-[#073F35]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Create website
        </a>
      </div>

      <section className="mb-[34px] grid gap-[14px] sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-4 rounded-[14px] border border-[#E4E8E5] bg-white p-[18px]">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
              style={{ backgroundColor: m.bg, color: m.fg }}
            >
              {m.icon}
            </span>
            <div className="min-w-0">
              <span className="block text-[11px] font-medium text-[#6D7774]">{m.label}</span>
              <strong className="block text-[21px] font-extrabold leading-tight">{m.value}</strong>
              <small className="block text-[10px] text-[#6D7774]">{m.sub}</small>
            </div>
          </div>
        ))}
      </section>

      <SitesGrid
        sites={sites.map((s) => ({
          id: s.id,
          business_name: s.business_name,
          status: s.status,
          slug: s.slug,
          category: s.category,
          created_at: s.created_at,
          requests: requestCounts[s.id] ?? 0,
        }))}
      />
    </DashboardShell>
  );
}
