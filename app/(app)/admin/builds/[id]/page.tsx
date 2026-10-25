import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, RotateCcw, XCircle, CheckCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LogViewer } from "@/components/admin/log-viewer";
import { StageTimeline } from "@/components/admin/stage-timeline";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { BuildStatusBadge, FailureBadge, KindBadge, ReviewedBadge } from "@/components/admin/badges";
import { requireAdmin } from "@/lib/auth";
import { getAdminBuild } from "@/lib/admin";
import { cancelBuild, markBuildReviewed, retryBuild } from "@/lib/admin-actions";
import {
  deriveBuildProgress,
  extractAdminTechnicalSummary,
  parseBuildStages,
  stageDurations,
  FAILURE_LABELS,
  type CustomerStageState,
  type FailureReason,
} from "@/lib/failures";
import { formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

function stateBadgeClass(state: CustomerStageState): string {
  if (state === "done") return "bg-emerald-100 text-emerald-800";
  if (state === "doing") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-500";
}

export default async function AdminBuildDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const build = await getAdminBuild(id);
  if (!build) notFound();

  const stages = parseBuildStages(build.log ?? "");
  const finishedAt = build.finished_at;
  const durations = stageDurations(stages, finishedAt);
  const totalSeconds = durations.reduce((a, d) => a + d.seconds, 0);

  const progress = deriveBuildProgress(build.status, build.log ?? "", totalSeconds);
  const technical = extractAdminTechnicalSummary(build.log ?? "");

  async function retry(fd: FormData) {
    "use server";
    return retryBuild(admin, id, String(fd.get("reason") ?? ""));
  }
  async function cancel(fd: FormData) {
    "use server";
    return cancelBuild(admin, id, String(fd.get("reason") ?? ""));
  }
  async function review() {
    "use server";
    return markBuildReviewed(admin, id);
  }

  const reasonLabel = build.failure_reason
    ? FAILURE_LABELS[build.failure_reason as FailureReason] ?? build.failure_reason
    : null;

  return (
    <div>
      <Link href="/admin/builds" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All builds
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {build.business_name}
            </h1>
            <KindBadge kind={build.kind} />
            <BuildStatusBadge status={build.status} />
            {build.failure_reason && <FailureBadge reason={build.failure_reason} />}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            by{" "}
            <Link href={`/admin/users/${build.owner_id}`} className="font-medium text-pine-800 hover:underline">
              {build.owner_email}
            </Link>{" "}
            · <Link href={`/admin/websites/${build.site_id}`} className="text-pine-800 hover:underline">view website</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {build.status === "failed" && (
            <ConfirmAction
              label={<><RotateCcw data-icon="inline-start" aria-hidden="true" /> Retry build</>}
              title="Retry this build?"
              description="A new build will be queued for this website with the same input. The worker will pick it up automatically."
              confirmLabel="Queue retry"
              action={retry}
              requireReason
              variant="outline"
              tone="default"
            />
          )}
          {(build.status === "queued" || build.status === "building") && (
            <ConfirmAction
              label={<><XCircle data-icon="inline-start" aria-hidden="true" /> Cancel stuck build</>}
              title="Cancel this build?"
              description="The build will be marked cancelled and the website returns to draft. Use this for builds stuck in an endless loop."
              confirmLabel="Cancel build"
              action={cancel}
              requireReason
            />
          )}
          {build.status === "failed" && build.reviewed !== 1 && (
            <ConfirmAction
              label={<><CheckCheck data-icon="inline-start" aria-hidden="true" /> Mark reviewed</>}
              title="Mark this failure as reviewed?"
              description="Records that a human has looked at this failure. It will stop showing under “Needs review”."
              confirmLabel="Mark reviewed"
              action={async () => review()}
              variant="outline"
              tone="default"
            />
          )}
        </div>
      </div>

      {build.status === "failed" && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Build failed{reasonLabel ? `: ${reasonLabel}` : ""}</AlertTitle>
          <AlertDescription>
            {build.input ? (
              <>
                Trigger: <span className="font-medium">“{build.input}”</span> —{" "}
              </>
            ) : null}
            the checklist below shows the last stage the build reached. Open the details section to read the raw log.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Created", value: formatDateTime(build.created_at) },
          { label: "Started", value: formatDateTime(build.started_at) },
          { label: "Finished", value: formatDateTime(build.finished_at) },
          { label: "Duration", value: formatDuration(build.started_at, build.finished_at) },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{m.label}</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold">Build progress</h2>
              <p className="mt-1 text-sm text-slate-600">{progress.currentSentence}</p>
              {progress.estimatedRemaining && (
                <p className="mt-0.5 text-xs text-slate-500">{progress.estimatedRemaining}</p>
              )}
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {progress.remainingCount} remaining
            </span>
          </div>

          <ol className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            {progress.stages.map((stage) => (
              <li
                key={stage.number}
                className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3.5 py-2 text-sm"
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
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${stateBadgeClass(stage.state)}`}
                >
                  {stage.state}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-5">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-display text-base font-bold text-slate-800 hover:text-slate-950">
              <span>Details (models, raw logs &amp; tokens)</span>
              <span className="inline-flex items-center gap-2 text-xs font-normal text-slate-400">
                <ReviewedBadge reviewed={build.reviewed} />
                <span className="rounded-md border border-slate-200 px-2 py-0.5 font-sans text-xs font-medium text-slate-600">
                  Toggle details
                </span>
              </span>
            </summary>

            <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
              {(technical.chain || technical.modelsUsed.length > 0 || technical.tokenNotes.length > 0) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1">
                  {technical.chain && (
                    <p>
                      <span className="font-semibold text-slate-500">Model chain:</span>{" "}
                      <span className="font-mono">{technical.chain}</span>
                    </p>
                  )}
                  {technical.modelsUsed.length > 0 && (
                    <p>
                      <span className="font-semibold text-slate-500">Model(s) invoked:</span>{" "}
                      <span className="font-mono">{technical.modelsUsed.join(", ")}</span>
                    </p>
                  )}
                  {technical.tokenNotes.length > 0 && (
                    <p>
                      <span className="font-semibold text-slate-500">Tokens:</span>{" "}
                      <span className="font-mono">{technical.tokenNotes.join(", ")}</span>
                    </p>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-slate-700">Stage timing</h3>
                <div className="mt-2">
                  <StageTimeline stages={stages} durations={durations} totalSeconds={totalSeconds} />
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Raw build log</h3>
                {build.log ? (
                  <LogViewer log={build.log} />
                ) : (
                  <p className="text-sm text-slate-400">
                    No log recorded for this build yet{build.status === "queued" ? " — it has not been picked up by the worker." : "."}
                  </p>
                )}
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-400">
        <Badge variant="outline">build {id}</Badge>
      </div>
    </div>
  );
}
