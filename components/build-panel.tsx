"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, StatusBadge } from "./ui";
import {
  deriveBuildProgress,
  type BuildProgressView,
  type CustomerStageState,
} from "@/lib/failures";

type TechnicalSummary = {
  modelsUsed: string[];
  chain: string | null;
  tokenNotes: string[];
};

type Build = {
  id: string;
  kind: string;
  status: string;
  log: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  progress?: BuildProgressView;
  technical?: TechnicalSummary;
  revertable?: boolean;
};

function parseDbTime(value: string | null): number {
  return value ? Date.parse(value.replace(" ", "T") + "Z") : NaN;
}

function durationLabel(start: string | null, end: string | null): string | null {
  const from = parseDbTime(start);
  const to = parseDbTime(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const seconds = Math.round((to - from) / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function stateBadgeClass(state: CustomerStageState): string {
  if (state === "done") return "bg-emerald-100 text-emerald-800";
  if (state === "doing") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-500";
}

export function BuildPanel({
  siteId,
  siteStatus,
  quotaLeft,
  isAdmin = false,
}: {
  siteId: string;
  siteStatus: string;
  quotaLeft: number;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasActive = useRef(false);

  const load = async () => {
    const res = await fetch(`/api/sites/${siteId}/builds`);
    if (!res.ok) return;
    const next: Build[] = await res.json();
    setBuilds(next);
    const nowActive = next.some((b) => b.status === "pending" || b.status === "queued" || b.status === "building");
    // The site header, chat and publish panels are server-rendered; refresh
    // them once the build leaves the active state so they don't stay stale.
    if (wasActive.current && !nowActive) router.refresh();
    wasActive.current = nowActive;
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const active = builds.some((b) => b.status === "pending" || b.status === "queued" || b.status === "building");
    if (!active) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builds]);

  const startBuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/build`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the build.");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not start the build.");
    } finally {
      setBusy(false);
    }
  };

  const revertBuild = async (buildId: string) => {
    const when = builds.find((b) => b.id === buildId)?.created_at;
    const whenText = when ? new Date(when + "Z").toLocaleString() : "that version";
    if (
      !window.confirm(
        `Revert the site to the version from ${whenText}? The current version will be replaced${siteStatus === "published" ? " and the live site will be updated" : ""}.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/builds/${buildId}/revert`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not revert.");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not revert.");
    } finally {
      setBusy(false);
    }
  };

  const active = builds.some((b) => b.status === "pending" || b.status === "queued" || b.status === "building");
  const activeBuild = builds.find((b) => b.status === "pending" || b.status === "queued" || b.status === "building");
  const latest = builds[0];
  const displayBuild = activeBuild || latest;

  const progress = displayBuild
    ? displayBuild.progress ?? deriveBuildProgress(displayBuild.status, displayBuild.log || "", 0)
    : null;
  const estimatedRemaining = progress?.estimatedRemaining ?? null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2 3 14h7l-1 8 11-12h-7l0-8z" />
            </svg>
          </span>
          AI build
        </h2>
        <StatusBadge status={siteStatus} />
      </div>
      <p className="mt-3 text-sm text-slate-500">
        The AI reads your business details and builds the full website — copy, layout and styling.
        {quotaLeft <= 0 ? " You are out of beta builds." : ` ${quotaLeft} beta build${quotaLeft === 1 ? "" : "s"} left.`}
      </p>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      <Button onClick={startBuild} disabled={busy || active || quotaLeft <= 0} className="mt-4 w-full">
        {busy ? "Starting…" : active ? "Build in progress…" : latest ? "Rebuild website" : "✨ Build my website"}
      </Button>

      {displayBuild && progress && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {activeBuild && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              <span className="text-sm font-medium text-slate-800">{progress.currentSentence}</span>
            </div>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600 shadow-2xs">
              {progress.remainingCount} remaining
            </span>
          </div>

          {estimatedRemaining && (
            <p className="mt-1.5 text-xs text-slate-500">{estimatedRemaining}</p>
          )}

          <ol className="mt-3 space-y-1.5 border-t border-slate-200/80 pt-3">
            {progress.stages.map((stage) => (
              <li
                key={stage.number}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span
                  className={
                    stage.state === "done"
                      ? "text-slate-700"
                      : stage.state === "doing"
                        ? "font-semibold text-slate-900"
                        : "text-slate-400"
                  }
                >
                  {stage.number}. {stage.label}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClass(stage.state)}`}
                >
                  {stage.state}
                </span>
              </li>
            ))}
          </ol>

          {isAdmin && (displayBuild.log || displayBuild.technical) && (
            <details className="mt-3 border-t border-slate-200/80 pt-2.5 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">
                Details (admin only)
              </summary>
              <div className="mt-2 space-y-1.5">
                {displayBuild.technical?.chain && (
                  <p>
                    <span className="font-medium text-slate-500">Model chain:</span>{" "}
                    <span className="font-mono">{displayBuild.technical.chain}</span>
                  </p>
                )}
                {displayBuild.technical?.modelsUsed && displayBuild.technical.modelsUsed.length > 0 && (
                  <p>
                    <span className="font-medium text-slate-500">Active model(s):</span>{" "}
                    <span className="font-mono">{displayBuild.technical.modelsUsed.join(", ")}</span>
                  </p>
                )}
                {displayBuild.technical?.tokenNotes && displayBuild.technical.tokenNotes.length > 0 && (
                  <p>
                    <span className="font-medium text-slate-500">Tokens:</span>{" "}
                    <span className="font-mono">{displayBuild.technical.tokenNotes.join(", ")}</span>
                  </p>
                )}
                {displayBuild.log && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">
                    {displayBuild.log}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {builds.length > 0 && (
        <div className="mt-5 space-y-2.5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent generation runs</p>
          {builds.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {b.kind === "revert" && (
                  <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Reverted</span>
                )}
                <span className="truncate text-slate-500">{new Date(b.created_at + "Z").toLocaleString()}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {durationLabel(b.started_at, b.finished_at) && (
                  <span className="font-mono text-xs text-slate-400">{durationLabel(b.started_at, b.finished_at)}</span>
                )}
                {b.revertable && (
                  <button
                    type="button"
                    onClick={() => revertBuild(b.id)}
                    disabled={busy || active}
                    className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-40"
                  >
                    Revert
                  </button>
                )}
                <StatusBadge status={b.status} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
