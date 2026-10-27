export type FailureReason =
  | "agent_timeout"
  | "qa_failed"
  | "agent_error"
  | "quota_exhausted"
  | "infra_error"
  | "interrupted"
  | "sanity_check"
  | "unknown";

export const FAILURE_LABELS: Record<FailureReason, string> = {
  agent_timeout: "Agent timeout",
  qa_failed: "QA failed",
  agent_error: "Agent report error",
  quota_exhausted: "Beta build error",
  infra_error: "Infrastructure error",
  interrupted: "Interrupted",
  sanity_check: "Sanity check failed",
  unknown: "Unknown",
};

export const REFUNDABLE_FAILURE_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "infra_error",
  "interrupted",
  "agent_timeout",
  "agent_error",
]);

export function shouldRefundQuota(reason: FailureReason, buildKind = "build"): boolean {
  if (buildKind !== "build") return false;
  return REFUNDABLE_FAILURE_REASONS.has(reason);
}

export function classifyFailure(msg: string): FailureReason {
  const m = msg.toLowerCase();
  if (m.includes("quota exhausted")) return "quota_exhausted";
  if (m.includes("interrupted by a server restart")) return "interrupted";
  if (m.includes("qa failed") || m.includes("qa report")) return "qa_failed";
  if (m.includes("sanity check failed") || m.includes("invalid brief")) return "sanity_check";
  if (m.includes("timed out") || m.includes("(timeout)")) return "agent_timeout";
  if (
    m.includes("agent reported an error") ||
    m.includes("agent failed with every model") ||
    m.includes("unexpected token")
  ) {
    return "agent_error";
  }
  if (
    m.includes("opencode serve") ||
    m.includes("workspace missing") ||
    m.includes("site row disappeared") ||
    m.includes("could not write opencode") ||
    m.includes("no usable build models")
  ) {
    return "infra_error";
  }
  return "unknown";
}

/** Find the reason of a failed build from its log (last FAILED: line wins). */
export function failureReasonFromLog(log: string): FailureReason {
  const lines = log.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const idx = line.indexOf("FAILED:");
    if (idx !== -1) return classifyFailure(line.slice(idx + 7));
  }
  return "unknown";
}

export type BuildStage = { stage: string; ts: string; text: string };

const STAGE_NAMES: Record<string, string> = {
  prepare: "Prepare",
  agent: "Agent",
  wiring: "Wiring",
  repair: "Repair",
  qa: "QA",
  finished: "Finished",
  failed: "Failed",
};

export const CUSTOMER_STAGE_LABELS = [
  "Understanding your business",
  "Designing your site",
  "Writing your pages",
  "Adding contact and booking",
  "Checking links, mobile view and forms",
  "Ready to publish",
] as const;

export type CustomerStageState = "done" | "doing" | "remaining";

export type CustomerStage = {
  number: number;
  label: string;
  state: CustomerStageState;
};

export type BuildProgressView = {
  stages: CustomerStage[];
  doneCount: number;
  doingCount: number;
  remainingCount: number;
  currentSentence: string;
  estimatedRemaining: string | null;
};

export function formatEstimatedRemaining(elapsedSeconds: number): string {
  const elapsedMin = Math.max(0, Math.floor(elapsedSeconds / 60));
  if (elapsedMin >= 15) {
    return "Wrapping up (normal total is 8–15 min)";
  }
  const low = Math.max(1, 8 - elapsedMin);
  const high = Math.max(low + 1, 15 - elapsedMin);
  return `About ${low}–${high} min left (normal total is 8–15 min)`;
}

/**
 * Map worker stage markers and log progress to the 6 plain-language stages.
 * When exact sub-stage progress inside an AI turn cannot be known, returns
 * "Working..." rather than inventing fake progress.
 */
export function deriveBuildProgress(
  status: string,
  log: string,
  elapsedSeconds = 0
): BuildProgressView {
  const safeLog = log || "";
  const isFinished =
    status === "ready" || /\[stage:finished\]|finished successfully/i.test(safeLog);

  if (isFinished) {
    return {
      stages: CUSTOMER_STAGE_LABELS.map((label, idx) => ({
        number: idx + 1,
        label,
        state: "done",
      })),
      doneCount: 6,
      doingCount: 0,
      remainingCount: 0,
      currentSentence: "Your website is ready to preview and publish.",
      estimatedRemaining: null,
    };
  }

  let activeIndex = 0;
  if (
    /analyzing the uploaded design|design plan ready|vision analysis skipped|media ready|site\.json seeded|stored media links expired|build model chain:/i.test(
      safeLog
    )
  ) {
    activeIndex = 1;
  }
  if (/\[stage:agent\]|opencode serve listening|prompt sent|agent still working/i.test(safeLog)) {
    activeIndex = 2;
  }
  if (
    /\[stage:wiring\]|agent idle after|restored \d+ locked|synced the homepage menu\/footer|re-pinned media fields/i.test(
      safeLog
    )
  ) {
    activeIndex = 3;
  }
  if (
    /\[stage:qa\]|\[stage:repair\]|running the browser QA|QA:|asking the AI to fix|re-running the browser QA/i.test(
      safeLog
    )
  ) {
    activeIndex = 4;
  }

  const isActive = status === "pending" || status === "queued" || status === "building";
  const stages: CustomerStage[] = CUSTOMER_STAGE_LABELS.map((label, idx) => {
    if (idx < activeIndex) return { number: idx + 1, label, state: "done" };
    if (idx === activeIndex && isActive) return { number: idx + 1, label, state: "doing" };
    return { number: idx + 1, label, state: "remaining" };
  });

  const doneCount = stages.filter((s) => s.state === "done").length;
  const doingCount = stages.filter((s) => s.state === "doing").length;
  const remainingCount = stages.filter((s) => s.state === "remaining").length;

  let currentSentence = "Working...";
  if (status === "pending" || status === "queued") {
    currentSentence = "Queued — your build will start in a moment.";
  } else if (status === "failed") {
    currentSentence = "This build stopped before finishing. You can start a new build to try again.";
  } else if (status === "cancelled") {
    currentSentence = "This build was cancelled.";
  } else if (status === "building") {
    if (activeIndex === 0) {
      currentSentence = "Reading your business details and setting up your workspace.";
    } else if (activeIndex === 1) {
      if (
        /analyzing the uploaded design/i.test(safeLog) &&
        !/design plan ready|vision analysis skipped/i.test(safeLog)
      ) {
        currentSentence = "Reading your design reference to plan the layout and colour palette.";
      } else if (/media ready|site\.json seeded/i.test(safeLog)) {
        currentSentence = "Preparing photos and colour tokens for your website.";
      } else {
        currentSentence = "Working... Preparing the visual direction and photos for your site.";
      }
    } else if (activeIndex === 2) {
      currentSentence = "Working... Writing your pages and styling your sections.";
    } else if (activeIndex === 3) {
      currentSentence = "Connecting navigation, contact details and booking forms across your pages.";
    } else if (activeIndex === 4) {
      if (
        /\[stage:repair\]|asking the AI to fix/i.test(safeLog) &&
        !/re-running the browser QA/i.test(safeLog)
      ) {
        currentSentence = "Fixing layout or form issues spotted during the browser check.";
      } else {
        currentSentence = "Checking links, mobile view and booking forms in a real browser.";
      }
    }
  }

  return {
    stages,
    doneCount,
    doingCount,
    remainingCount,
    currentSentence,
    estimatedRemaining: isActive ? formatEstimatedRemaining(elapsedSeconds) : null,
  };
}

export function extractAdminTechnicalSummary(log: string): {
  modelsUsed: string[];
  chain: string | null;
  tokenNotes: string[];
} {
  const modelsUsed: string[] = [];
  let chain: string | null = null;
  const tokenNotes: string[] = [];
  for (const raw of (log || "").split("\n")) {
    const mChain = raw.match(/build model chain:\s*(.+)$/i);
    if (mChain) chain = mChain[1].trim();
    const mModel = raw.match(/agent model:\s*([^\s(]+)/i);
    if (mModel && !modelsUsed.includes(mModel[1])) modelsUsed.push(mModel[1]);
    const mTok = raw.match(/tokens?[:=]\s*[\d,]+/i);
    if (mTok) tokenNotes.push(mTok[0]);
  }
  return { modelsUsed, chain, tokenNotes };
}

/** Derive a stage timeline from a build log (works for legacy logs too). */
export function parseBuildStages(log: string): BuildStage[] {
  const stages: BuildStage[] = [];
  let current: string | null = null;
  for (const raw of log.split("\n")) {
    if (!raw) continue;
    const m = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    const ts = m[1];
    const text = m[2];
    let stage: string | null = null;
    const marker = text.match(/^\[stage:([a-z_]+)\]\s*(.*)$/);
    if (marker) {
      stage = marker[1];
    } else {
      if (/^Starting (build|refine)/.test(text) || /opencode serve listening/.test(text)) stage = "prepare";
      else if (/prompt sent|agent session|reusing agent session/.test(text)) stage = "agent";
      else if (/repair|asking the AI to fix/.test(text)) stage = "repair";
      else if (/running the browser QA|QA:|QA after repair/.test(text)) stage = "qa";
      else if (/finished successfully/.test(text)) stage = "finished";
      else if (/^FAILED:/.test(text)) stage = "failed";
    }
    if (!stage) continue;
    const name = STAGE_NAMES[stage] ?? stage;
    if (current === name) {
      stages[stages.length - 1].text += "\n" + text;
    } else {
      stages.push({ stage: name, ts, text });
      current = name;
    }
  }
  return stages;
}

/** How long each stage took, in seconds, from the stage timeline. */
export function stageDurations(stages: BuildStage[], finishedAt: string | null): { stage: string; seconds: number }[] {
  const out: { stage: string; seconds: number }[] = [];
  for (let i = 0; i < stages.length; i++) {
    const from = new Date(stages[i].ts).getTime();
    const to = i + 1 < stages.length
      ? new Date(stages[i + 1].ts).getTime()
      : finishedAt
        ? new Date(finishedAt).getTime()
        : from;
    const seconds = Math.max(0, Math.round((to - from) / 1000));
    out.push({ stage: stages[i].stage, seconds });
  }
  return out;
}
