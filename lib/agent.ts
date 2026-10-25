import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import { buildAgentEnv } from "./agent-env";

/**
 * Thin client for `opencode serve` (verified against opencode 1.19.0's live
 * OpenAPI at GET /doc):
 *   POST /api/session                       -> create session {data:{id}}
 *   POST /api/session/{id}/prompt           -> {text} (v2; v1 used /session/{id}/prompt_async)
 *   POST /api/session/{id}/abort
 *   GET  /api/event                         -> SSE; completion = session.idle
 *   POST /api/session/{id}/permission/{rid}/reply -> {reply:"allow"|"deny"}
 * Auth: HTTP Basic (username "opencode") when OPENCODE_SERVER_PASSWORD is set.
 */

const OPENCODE_BIN = process.env.OPENCODE_BIN || "/home/builder/.opencode/bin/opencode";

export interface ServeHandle {
  proc: ChildProcess;
  port: number;
  username: string;
  password: string;
}

function basicAuth(h: ServeHandle): string {
  return "Basic " + Buffer.from(`${h.username}:${h.password}`).toString("base64");
}

export async function startServe(workspaceDir: string, models: readonly string[] = []): Promise<ServeHandle> {
  const password = crypto.randomBytes(24).toString("hex");
  const proc = spawn(OPENCODE_BIN, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd: workspaceDir,
    env: { ...buildAgentEnv(models), OPENCODE_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("opencode serve did not report a port within 60s"));
    }, 60000);
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        cleanup();
        resolve(parseInt(m[1], 10));
      }
    };
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`opencode serve exited early (code ${code}): ${out.slice(-600)}`));
    };
    const cleanup = () => {
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("exit", onExit);
    };
    // The "listening on" line goes to stdout (not stderr) in opencode 1.19.0.
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", onExit);
  });

  return { proc, port, username: "opencode", password };
}

async function ocJson(h: ServeHandle, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${h.port}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(h),
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`opencode ${init.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  if (text.trimStart().startsWith("<!doctype")) {
    throw new Error(`opencode ${init.method || "GET"} ${path} -> served SPA HTML (wrong path prefix?)`);
  }
  return text ? JSON.parse(text) : null;
}

export async function createSession(h: ServeHandle, title: string): Promise<string> {
  const json = await ocJson(h, "/api/session", { method: "POST", body: JSON.stringify({ title }) });
  return json.data.id as string;
}

export async function promptAsync(h: ServeHandle, sessionId: string, text: string, agent = "build"): Promise<void> {
  // v2 API: POST /api/session/{id}/prompt with {text}
  // (v1 used /session/{id}/prompt_async with {agent, parts:[...]})
  await ocJson(h, `/api/session/${sessionId}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function abortSession(h: ServeHandle, sessionId: string): Promise<void> {
  try {
    await ocJson(h, `/api/session/${sessionId}/abort`, { method: "POST" });
  } catch {
    /* best effort */
  }
}

/** Fetch the last assistant text reply in a session (best effort, shape-defensive). */
export async function lastAssistantText(h: ServeHandle, sessionId: string): Promise<string | null> {
  try {
    const json = await ocJson(h, `/api/session/${sessionId}/message`);
    const messages: any[] = json.data || json || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const role = m.role || m.info?.role;
      if (role !== "assistant") continue;
      const parts: any[] = m.parts || m.info?.parts || [];
      const text = parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text || p.data?.text || "")
        .join("\n")
        .trim();
      if (text) return text.slice(0, 2000);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type IdleResult = "idle" | "error" | "timeout";

const OPENCODE_DB = "/home/builder/.local/share/opencode/opencode.db";

/**
 * Last "turn finished" marker for a session, read before prompting. Without a
 * baseline, a re-used session's previous idle timestamp reads as completion.
 */
export async function getSessionIdleMark(sessionId: string): Promise<number> {
  try {
    const Database = (await import("better-sqlite3")).default;
    const odb = new Database(OPENCODE_DB, { readonly: true });
    try {
      const row = odb.prepare("SELECT time_idle FROM session_v2 WHERE id = ?").get(sessionId) as any;
      return Number(row?.time_idle ?? 0);
    } finally {
      odb.close();
    }
  } catch {
    return 0;
  }
}

/**
 * Wait for the current agent turn to finish.
 *
 * opencode v2 records completion explicitly: session_v2.time_idle and a
 * session_message row with type='idle' (data.outcome). Poll until either
 * marker is newer than `sinceIdleMark`. Do not infer completion from message
 * counts or quiet periods — that reported "done" 33s into a 5-minute build.
 */
export async function waitForIdle(
  h: ServeHandle,
  sessionId: string,
  timeoutMs: number,
  sinceIdleMark = 0,
  onEvent?: (type: string, detail: string) => void
): Promise<IdleResult> {
  const Database = (await import("better-sqlite3")).default;
  const POLL_MS = 1500;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastNote = 0;

  while (Date.now() < deadline) {
    try {
      const odb = new Database(OPENCODE_DB, { readonly: true });
      try {
        const sess = odb
          .prepare("SELECT time_idle, idle_outcome FROM session_v2 WHERE id = ?")
          .get(sessionId) as any;

        let assistantCount = 0;
        let lastIdleMsg = 0;
        let idleData = "";
        try {
          const a = odb
            .prepare("SELECT COUNT(*) c FROM session_message WHERE session_id = ? AND type = 'assistant'")
            .get(sessionId) as any;
          assistantCount = Number(a?.c ?? 0);
          const i = odb
            .prepare(
              "SELECT time_created, data FROM session_message WHERE session_id = ? AND type = 'idle' ORDER BY seq DESC LIMIT 1"
            )
            .get(sessionId) as any;
          lastIdleMsg = Number(i?.time_created ?? 0);
          idleData = String(i?.data ?? "");
        } catch {
          /* older schema without session_message */
        }

        const idleAt = Math.max(Number(sess?.time_idle ?? 0), lastIdleMsg);
        if (idleAt > sinceIdleMark) {
          const outcome = String(sess?.idle_outcome || "succeeded");
          if (outcome !== "succeeded") {
            let detail = "";
            try {
              const d = JSON.parse(idleData || "{}");
              detail = d?.error?.message || d?.error?.type || "";
            } catch {
              /* ignore */
            }
            onEvent?.("error", `agent finished with idle_outcome=${outcome}${detail ? ": " + detail : ""}`);
            return "error";
          }
          if (assistantCount === 0) {
            onEvent?.("error", "agent went idle without producing an assistant reply");
            return "error";
          }
          return "idle";
        }
      } finally {
        odb.close();
      }
    } catch (e: any) {
      onEvent?.("error", "db poll failed: " + e.message);
    }

    if (Date.now() - lastNote > 30_000) {
      lastNote = Date.now();
      onEvent?.("waiting", `agent still working (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return "timeout";
}

export async function stopServe(h: ServeHandle): Promise<void> {
  try {
    h.proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          h.proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 5000);
      h.proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  } catch {
    /* ignore */
  }
}
