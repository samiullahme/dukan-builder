"use client";

import { useState } from "react";
import { Card } from "./ui";

type Device = { id: "desktop" | "tablet" | "mobile"; label: string; width: string };

const DEVICES: Device[] = [
  { id: "desktop", label: "Desktop", width: "100%" },
  { id: "tablet", label: "Tablet", width: "768px" },
  { id: "mobile", label: "Mobile", width: "390px" },
];

const DEVICE_ICONS: Record<Device["id"], React.ReactNode> = {
  desktop: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  ),
  tablet: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M12 18h.01" />
    </svg>
  ),
  mobile: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2" /><path d="M12 18h.01" />
    </svg>
  ),
};

export function PreviewPane({ status, slug }: { status: string; slug: string }) {
  const [device, setDevice] = useState<Device["id"]>("desktop");
  const [tick, setTick] = useState(0);
  const live = status === "published";
  const src = live ? `https://${slug}.lanesite.pro` : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="font-semibold text-slate-900">Live preview</h2>
          <p className="font-mono text-[11px] text-slate-400">
            {live ? `${slug}.lanesite.pro` : "Publish your site to see the live preview"}
          </p>
        </div>
        {live && (
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                onClick={() => setDevice(d.id)}
                title={d.label}
                className={`grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors ${
                  device === d.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                {DEVICE_ICONS[d.id]}
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-slate-200" />
            <button
              onClick={() => setTick((t) => t + 1)}
              title="Reload preview"
              className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-slate-400 transition-colors hover:text-slate-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="grid place-items-center bg-slate-50 p-5">
        {src ? (
          <iframe
            key={`${device}-${tick}`}
            src={src}
            title="Live site preview"
            className="h-[480px] rounded-lg border border-slate-200 bg-white shadow-sm"
            style={{ width: DEVICES.find((d) => d.id === device)!.width, maxWidth: "100%" }}
          />
        ) : (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-white text-slate-300 shadow-sm">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <p className="mt-4 font-medium text-slate-500">Your preview appears here</p>
            <p className="mt-1 text-sm text-slate-400">
              {status === "ready"
                ? "Your site is built — publish it to see it live here."
                : "Start the AI build to generate your website."}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
