"use client";

import { useState } from "react";
import { Button, Card, StatusBadge } from "./ui";

export function PublishPanel({ siteId, siteStatus, slug }: { siteId: string; siteStatus: string; slug: string }) {
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(
    siteStatus === "published" ? `https://${slug}.lanesite.pro` : null
  );
  const built = siteStatus === "ready" || siteStatus === "published";

  const startPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/preview`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the preview.");
      window.open("https://preview.lanesite.pro", "_blank", "noopener");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/publish`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not publish.");
      setPublishedUrl(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </span>
          Preview & publish
        </h2>
        <StatusBadge status={siteStatus} />
      </div>
      {!built ? (
        <p className="mt-3 text-sm text-slate-500">
          Available once your site is built — preview it privately, then publish to your free live link or download the code.
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Preview is private (beta password required). Publishing puts your site live for everyone.
        </p>
      )}
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {publishedUrl && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm">
          <span className="text-slate-500">Live at </span>
          <a href={publishedUrl} target="_blank" rel="noreferrer" className="font-mono font-semibold text-emerald-800 hover:underline">
            {publishedUrl}
          </a>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={startPreview} disabled={!built || busy !== null} variant="secondary">
          {busy === "preview" ? "Starting…" : "👁 Preview site"}
        </Button>
        <Button onClick={publish} disabled={!built || busy !== null} variant="success">
          {busy === "publish" ? "Publishing…" : siteStatus === "published" ? "↻ Republish" : "🚀 Publish site"}
        </Button>
        <a
          href={built ? `/api/sites/${siteId}/download` : undefined}
          onClick={(e) => { if (!built) e.preventDefault(); }}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
            built ? "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50" : "cursor-not-allowed bg-slate-100 text-slate-400"
          }`}
        >
          ⬇ Download ZIP
        </a>
      </div>
      {!built && <p className="mt-3 text-xs text-slate-400">Start the AI build above to unlock these.</p>}
    </Card>
  );
}
