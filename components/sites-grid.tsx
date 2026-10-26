"use client";

import { useMemo, useState } from "react";

type SiteRow = {
  id: string;
  business_name: string;
  status: string;
  slug: string;
  category: string;
  created_at: string;
  requests: number;
};

const TILE_COLORS: Record<string, string> = {
  restaurant: "#B95034",
  salon: "#8A5A83",
  clinic: "#2F6E6B",
  retail: "#332F4E",
  "real-estate": "#46594B",
  other: "#55627A",
};

const SHORT_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  salon: "Salon & beauty",
  clinic: "Clinic",
  retail: "Shop & boutique",
  "real-estate": "Real estate",
  other: "Local business",
};

function statusMeta(status: string): { label: string; dot: string } {
  switch (status) {
    case "published":
      return { label: "Live", dot: "#32A170" };
    case "ready":
      return { label: "Ready", dot: "#32A170" };
    case "building":
      return { label: "Building", dot: "#D97706" };
    case "queued":
      return { label: "Queued", dot: "#D97706" };
    case "failed":
      return { label: "Failed", dot: "#DC2626" };
    default:
      return { label: "Draft", dot: "#9DA5A2" };
  }
}

function createdLabel(value: string): string {
  const d = new Date(value + "Z");
  if (Number.isNaN(d.getTime())) return "Recently";
  return `Created ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export function SitesGrid({ sites }: { sites: SiteRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (s) => s.business_name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)
    );
  }, [sites, query]);

  return (
    <section id="websites" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-bold">All websites</h2>
          <span className="text-xs text-[#6D7774]">
            {sites.length} website{sites.length === 1 ? "" : "s"}
          </span>
        </div>
        <label className="flex h-9 w-full max-w-[240px] items-center gap-2 rounded-[10px] border border-[#E4E8E5] bg-white px-[11px] transition focus-within:border-[#0B5949]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#6D7774]">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search websites"
            className="w-full bg-transparent text-sm text-[#17201E] placeholder:text-[#9DA5A2] focus:outline-none"
          />
        </label>
      </div>

      <div className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        <a
          href="/sites/new"
          className="flex min-h-[346px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-[#CBD4CF] bg-white/45 p-6 text-center transition hover:border-[#0B5949] hover:bg-white"
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#0B5949] text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </span>
          <strong className="text-[15px] font-bold">Create a new website</strong>
          <p className="max-w-[220px] text-xs leading-relaxed text-[#6D7774]">
            Tell us about your shop and let AI do the rest.
          </p>
        </a>

        {filtered.map((s) => {
          const color = TILE_COLORS[s.category] ?? TILE_COLORS.other;
          const meta = statusMeta(s.status);
          return (
            <article
              key={s.id}
              className="flex flex-col overflow-hidden rounded-[20px] border border-[#E4E8E5] bg-white transition-shadow hover:shadow-md"
            >
              <div className="relative h-40 shrink-0 overflow-hidden" style={{ backgroundColor: color }}>
                <div className="absolute left-4 top-4 flex gap-[3px]">
                  <i className="block h-1 w-1 rounded-full bg-[#FFF5E8]/80" />
                  <i className="block h-1 w-1 rounded-full bg-[#FFF5E8]/80" />
                  <i className="block h-1 w-1 rounded-full bg-[#FFF5E8]/80" />
                </div>
                <div className="absolute right-3.5 top-3.5 flex items-center gap-[5px] rounded-[20px] bg-white/90 px-[7px] py-1 text-[8px] font-bold text-[#5B5D5B]">
                  <i className="block h-[5px] w-[5px] rounded-full" style={{ backgroundColor: meta.dot }} />
                  {meta.label}
                </div>
                <div className="absolute left-5 top-[60px] grid gap-[7px] text-[#FFF5E8]">
                  <small className="text-[7px] font-bold uppercase tracking-[0.84px]">
                    {SHORT_LABELS[s.category] ?? "Local business"}
                  </small>
                  <strong className="max-w-[85%] text-[21px] font-extrabold leading-tight">{s.business_name}</strong>
                </div>
                <div className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/10" />
              </div>

              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <a href={`/sites/${s.id}`} className="group min-w-0">
                    <h3 className="truncate text-[14px] font-bold transition-colors group-hover:text-[#0B5949]">
                      {s.business_name}
                    </h3>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-[#6D7774]">
                      {s.slug}.lanesite.pro
                    </p>
                  </a>
                  <a
                    href={`/sites/${s.id}`}
                    title="Open workspace"
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] text-[#59635F] transition hover:bg-[#F1F5F3] hover:text-[#17201E]"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="19" cy="12" r="1" />
                      <circle cx="5" cy="12" r="1" />
                    </svg>
                  </a>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-[9px] text-[#6D7774]">
                  <span>
                    <strong className="font-bold text-[#17201E]">—</strong> visits
                  </span>
                  <span>
                    <strong className="font-bold text-[#17201E]">{s.requests}</strong> request
                    {s.requests === 1 ? "" : "s"}
                  </span>
                  <span>{createdLabel(s.created_at)}</span>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <a
                    href={`/sites/${s.id}`}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#D5DBD7] bg-white px-4 text-[11px] font-bold transition hover:border-[#0B5949] hover:text-[#0B5949]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
                      <path d="m14 7 3 3" />
                      <path d="M5 6v4" />
                      <path d="M19 14v4" />
                      <path d="M10 2v2" />
                      <path d="M7 8H3" />
                      <path d="M21 16h-4" />
                      <path d="M11 3H9" />
                    </svg>
                    Edit site
                  </a>
                  {s.status === "published" && (
                    <a
                      href={`https://${s.slug}.lanesite.pro`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open live site"
                      className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#D5DBD7] bg-white text-[#59635F] transition hover:border-[#0B5949] hover:text-[#0B5949]"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 && sites.length > 0 && (
        <div className="mt-4 rounded-[14px] border border-dashed border-[#CBD4CF] px-6 py-8 text-center text-sm text-[#6D7774]">
          No websites match “{query}”.
        </div>
      )}
    </section>
  );
}
