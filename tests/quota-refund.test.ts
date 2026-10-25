import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlCalls: { sql: string; params: unknown[] }[] = [];

vi.mock("../lib/db", () => ({
  default: {
    prepare: (sql: string) => ({
      run: async (...params: unknown[]) => {
        sqlCalls.push({ sql, params });
        return { changes: 1 };
      },
      get: async (...params: unknown[]) => {
        sqlCalls.push({ sql, params });
        return { user_id: "user-abc" };
      },
      all: async () => [],
    }),
  },
}));

import {
  classifyFailure,
  deriveBuildProgress,
  shouldRefundQuota,
} from "../lib/failures";
import { failBuild } from "../worker/build-worker";

describe("quota refund on failure", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
  });

  it("refunds 1 quota unit for infra_error, interrupted, agent_timeout and agent_error", async () => {
    const cases = [
      { msg: "opencode serve exited early (code 1)", expected: "infra_error" },
      { msg: "build was interrupted by a server restart — please build again", expected: "interrupted" },
      { msg: "agent failed with every model (opencode/deepseek-v4.1-flash-free (timeout))", expected: "agent_timeout" },
      { msg: "agent failed with every model (opencode/deepseek-v4.1-flash-free (error))", expected: "agent_error" },
    ] as const;

    for (const c of cases) {
      sqlCalls.length = 0;
      expect(classifyFailure(c.msg)).toBe(c.expected);
      expect(shouldRefundQuota(c.expected, "build")).toBe(true);

      const reason = await failBuild("build-1", "site-1", c.msg, {
        userId: "user-1",
        buildKind: "build",
        quotaConsumed: true,
      });
      expect(reason).toBe(c.expected);

      const refundCall = sqlCalls.find((call) =>
        call.sql.includes("UPDATE quota SET builds_used = GREATEST(0, builds_used - 1)")
      );
      expect(refundCall).toBeDefined();
      expect(refundCall?.params).toEqual(["user-1"]);
    }
  });

  it("does NOT refund quota for QA failure after repair or user-invalid briefs", async () => {
    const noRefundMessages = [
      "QA failed after repair: horizontal overflow on mobile",
      "QA failed and the repair turn failed (opencode/deepseek-v4.1-flash-free (timeout))",
      "sanity check failed: site.json has no business_name",
      "invalid brief: missing required business fields",
      "beta build quota exhausted",
    ];

    for (const msg of noRefundMessages) {
      sqlCalls.length = 0;
      await failBuild("build-2", "site-2", msg, {
        userId: "user-1",
        buildKind: "build",
        quotaConsumed: true,
      });

      const refundCall = sqlCalls.find((call) =>
        call.sql.includes("UPDATE quota SET builds_used = GREATEST(0, builds_used - 1)")
      );
      expect(refundCall).toBeUndefined();
    }
  });

  it("does NOT refund quota for chat refinements or when quota was not consumed", async () => {
    await failBuild("build-3", "site-3", "opencode serve exited early", {
      userId: "user-1",
      buildKind: "refine",
      quotaConsumed: true,
    });
    await failBuild("build-4", "site-4", "workspace missing: /opt/tenants/u/s", {
      userId: "user-1",
      buildKind: "build",
      quotaConsumed: false,
    });

    const refundCall = sqlCalls.find((call) =>
      call.sql.includes("UPDATE quota SET builds_used = GREATEST(0, builds_used - 1)")
    );
    expect(refundCall).toBeUndefined();
  });
});

describe("6-stage plain-language build progress", () => {
  it("tracks stages from doing to done with remaining count and non-fake time estimate", () => {
    const p1 = deriveBuildProgress("building", "[2026-10-25T18:00:00Z] [stage:prepare]\n", 60);
    expect(p1.stages).toHaveLength(6);
    expect(p1.stages[0]).toEqual({
      number: 1,
      label: "Understanding your business",
      state: "doing",
    });
    expect(p1.remainingCount).toBe(5);
    expect(p1.estimatedRemaining).toContain("7–14 min");

    const p3 = deriveBuildProgress(
      "building",
      "[2026-10-25T18:00:00Z] [stage:prepare]\n[2026-10-25T18:01:00Z] [stage:agent]\n",
      180
    );
    expect(p3.stages[0].state).toBe("done");
    expect(p3.stages[1].state).toBe("done");
    expect(p3.stages[2].state).toBe("doing");
    expect(p3.remainingCount).toBe(3);
    expect(p3.currentSentence.startsWith("Working...")).toBe(true);

    const pDone = deriveBuildProgress("ready", "[2026-10-25T18:10:00Z] [stage:finished]\n", 600);
    expect(pDone.doneCount).toBe(6);
    expect(pDone.remainingCount).toBe(0);
    expect(pDone.stages.every((s) => s.state === "done")).toBe(true);
  });
});
