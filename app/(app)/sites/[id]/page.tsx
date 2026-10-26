import { notFound } from "next/navigation";
import { Card, StatusBadge } from "@/components/ui";
import { BuildPanel } from "@/components/build-panel";
import { ChatPanel } from "@/components/chat-panel";
import { PublishPanel } from "@/components/publish-panel";
import { OwnerAccess } from "@/components/owner-access";
import { PreviewPane } from "@/components/preview-pane";
import { requireUser } from "@/lib/auth";
import db from "@/lib/db";
import { getSiteForUser } from "@/lib/site";
import { getCategory } from "@/lib/categories";
import { getTotpStatus } from "@/lib/site-admin";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) notFound();

  const brief = (await db.prepare("SELECT * FROM briefs WHERE site_id = ?").get(site.id)) as any;
  const quota = (await db.prepare("SELECT builds_used, builds_allowed FROM quota WHERE user_id = ?").get(user.id)) as any;
  const quotaLeft = Math.max(0, (quota?.builds_allowed ?? 5) - (quota?.builds_used ?? 0));
  const publicUrl = `https://${site.slug}.lanesite.pro`;
  let designPlan: any = null;
  try {
    designPlan = brief?.design_plan ? JSON.parse(brief.design_plan) : null;
  } catch {
    designPlan = null;
  }

  const briefRows: [string, string][] = [
    ["Business type", getCategory(site.category).label],
    ["Phone", brief?.phone],
    ["Address", brief?.address],
    ["Hours", brief?.hours],
    ["Colour direction", brief?.colors],
  ].filter(([, v]) => v) as [string, string][];

  const totp = await getTotpStatus(user.id);
  const unlockedMs =
    totp.enabled && totp.unlocked_until ? Date.parse(totp.unlocked_until.replace(" ", "T") + "Z") : 0;
  const unlockedUntil = unlockedMs > Date.now() ? totp.unlocked_until : null;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <a href="/dashboard" className="font-medium text-slate-500 hover:text-slate-800">All sites</a>
        <span>/</span>
        <span className="truncate text-slate-700">{site.business_name}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{site.business_name}</h1>
            <StatusBadge status={site.status} />
          </div>
          <p className="mt-1.5 text-sm text-slate-500">
            {site.status === "published" ? (
              <>Live at <a href={publicUrl} target="_blank" rel="noreferrer" className="font-mono font-semibold text-emerald-700 hover:underline">{publicUrl}</a></>
            ) : (
              <>Will publish to <span className="font-mono text-slate-600">{site.slug}.lanesite.pro</span></>
            )}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <BuildPanel siteId={site.id} siteStatus={site.status} quotaLeft={quotaLeft} isAdmin={user.is_admin === 1} />

          <OwnerAccess siteId={site.id} enabled={totp.enabled} unlockedUntil={unlockedUntil} />

          <ChatPanel siteId={site.id} canChat={site.status === "ready" || site.status === "published"} />
        </div>

        <div className="space-y-5 lg:col-span-3">
          <PreviewPane status={site.status} slug={site.slug} />

          {brief?.design_image && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" />
                    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                  </svg>
                </span>
                <h2 className="font-semibold text-slate-900">Design reference</h2>
              </div>
              <div className="flex flex-wrap gap-4 p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/sites/${site.id}/design`}
                  alt="Uploaded design reference"
                  className="h-28 w-40 rounded-lg border border-slate-200 object-cover"
                />
                <div className="min-w-[180px] flex-1 space-y-2 text-sm">
                  {designPlan?.style && <p><span className="font-medium text-slate-400">Style:</span> <span className="text-slate-800">{designPlan.style}</span></p>}
                  {designPlan?.typography && <p><span className="font-medium text-slate-400">Type:</span> <span className="text-slate-800">{designPlan.typography}</span></p>}
                  {Array.isArray(designPlan?.color_palette) && designPlan.color_palette.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                      {designPlan.color_palette.slice(0, 6).map((c: string) => (
                        <span key={c} className="h-5 w-5 rounded-full border border-slate-200" style={{ backgroundColor: c }} title={c} />
                      ))}
                    </div>
                  )}
                  {!designPlan && <p className="text-slate-400">The design brief is prepared before the build.</p>}
                  {brief.design_notes && <p className="text-slate-600"><span className="font-medium text-slate-400">Notes:</span> {brief.design_notes}</p>}
                </div>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" />
                </svg>
              </span>
              <h2 className="font-semibold text-slate-900">Business details</h2>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              {briefRows.map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-32 shrink-0 font-medium text-slate-400">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
              {brief?.services && (
                <div className="flex gap-4">
                  <dt className="w-32 shrink-0 font-medium text-slate-400">Services</dt>
                  <dd className="whitespace-pre-line text-slate-800">{brief.services}</dd>
                </div>
              )}
              {brief?.instructions && (
                <div className="flex gap-4">
                  <dt className="w-32 shrink-0 font-medium text-slate-400">About</dt>
                  <dd className="text-slate-800">{brief.instructions}</dd>
                </div>
              )}
            </dl>
          </Card>

          <PublishPanel siteId={site.id} siteStatus={site.status} slug={site.slug} />
        </div>
      </div>
    </div>
  );
}
