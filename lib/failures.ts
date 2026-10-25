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

export function classifyFailure(msg: string): FailureReason {
  const m = msg.toLowerCase();
  if (m.includes("quota exhausted")) return "quota_exhausted";
  if (m.includes("interrupted by a server restart")) return "interrupted";
  if (m.includes("timed out")) return "agent_timeout";
  if (m.includes("qa failed") || m.includes("qa report")) return "qa_failed";
  if (m.includes("agent reported an error") || m.includes("unexpected token")) return "agent_error";
  if (m.includes("sanity check failed")) return "sanity_check";
  if (
    m.includes("opencode serve") ||
    m.includes("workspace missing") ||
    m.includes("site row disappeared") ||
    m.includes("could not write opencode")
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
  repair: "Repair",
  qa: "QA",
  finished: "Finished",
  failed: "Failed",
};

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
