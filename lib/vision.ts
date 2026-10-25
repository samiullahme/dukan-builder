import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { usableModels } from "./model-chain";

const OPENCODE_BIN = process.env.OPENCODE_BIN || "/home/builder/.opencode/bin/opencode";
// Vision-capable models tried in order — the primary one timed out on
// some real uploads, so the next model in the chain gets a shot instead of
// silently falling back to a generic category design. Provider-qualified ids
// work here too; entries whose provider has no key are skipped.
const VISION_MODELS = usableModels(
  (
    process.env.OPENCODE_VISION_MODELS ||
    `${process.env.VISION_MODEL || "opencode/glm-5.3-flash-free"},opencode/nemotron-3.5-super-vl-free,opencode/space-bunny-free,opencode/mimo-v2.6-flash-free`
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
).usable;

export type PlanSection = { name: string; description: string; text_content: string };

export type DesignPlan = {
  site_title: string;
  design_prompt: string;
  style: string;
  layout_description: string;
  sections: PlanSection[];
  color_palette: string[];
  typography: string;
  image_queries: string[];
  video_queries: string[];
  model: string;
  analyzed_at: string;
};

const VISION_PROMPT = `You are a senior web designer. Analyze the attached website design reference image and turn it into an implementation-ready design brief.

Return ONLY one valid JSON object, with no markdown fences and no commentary, matching exactly this shape:
{
  "site_title": "short description of the kind of business this design suits",
  "design_prompt": "a detailed 120-220 word prompt describing the layout order, every section, spacing, typography, colours, imagery treatment, mood and what makes the design distinctive; write it as an instruction to a web developer",
  "style": "3-8 words naming the aesthetic",
  "layout_description": "1-2 sentences on the page structure",
  "sections": [{"name": "hero", "description": "what this section shows and how it is laid out", "text_content": "the kind of copy or content it holds"}],
  "color_palette": ["#1a1a1a", "#c9a227", "#f7f3eb"],
  "typography": "specific font pairing and weights, e.g. 'Playfair Display headings, Inter body'",
  "image_queries": ["4-8 SHORT keyword search phrases of 2-4 words each, e.g. 'chicken karahi', 'modern dental clinic', 'naan bread basket' — never full sentences"],
  "video_queries": ["0-3 SHORT keyword search phrases of 2-4 words each, never full sentences"]
}

Rules:
- Describe the LAYOUT and VISUAL SYSTEM, not the literal words in the image. If text is unreadable, infer what the section is for.
- The image is a design reference only. Never copy its brand name, logo, or exact marketing copy.
- Include 4-8 sections in document order (hero first). Use generic names like hero, services, gallery, about, testimonials, contact.
- color_palette must contain 3-6 hex colours that actually appear in the design, ordered from dominant to accent.
- image_queries and video_queries must be short keyword phrases (2-4 words) that would find good stock photos of this business type, e.g. "chicken karahi", "dental clinic interior". Full sentences return bad stock-photo search results.
- Output raw JSON only.`;

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/** Find every balanced {...} block that parses as JSON. Tolerant of JSONL event wrappers. */
function extractJsonObjects(raw: string): any[] {
  const text = stripAnsi(raw);
  const out: any[] = [];
  const starts: number[] = [];
  for (let i = 0; i < text.length && starts.length < 120; i++) {
    if (text[i] === "{") starts.push(i);
  }
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            out.push(JSON.parse(slice));
          } catch {
            // not JSON, keep scanning
          }
          break;
        }
      }
      if (out.length >= 60) return out;
    }
  }
  return out;
}

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

function normalizeHex(v: unknown): string | null {
  const s = asString(v, 20);
  const m = s.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return "#" + hex.toLowerCase();
}

/** Pick the candidate object that looks most like a design plan. */
function pickPlan(objects: any[]): any | null {
  const scored = objects
    .filter((o) => o && typeof o === "object" && !Array.isArray(o))
    .map((o) => {
      let score = 0;
      if (Array.isArray(o.sections) && o.sections.length >= 2) score += 4;
      if (Array.isArray(o.color_palette)) score += 3;
      if (typeof o.design_prompt === "string" && o.design_prompt.length > 60) score += 3;
      if (typeof o.style === "string") score += 1;
      if (typeof o.typography === "string") score += 1;
      if (Array.isArray(o.image_queries)) score += 2;
      return { o, score };
    })
    .sort((a, b) => b.score - a.score);
  for (const { o, score } of scored) {
    if (score >= 6) {
      // opencode may wrap the answer: {type:"text", text:"{...json...}"}
      if (typeof o.text === "string" && !o.sections) {
        const inner = extractJsonObjects(o.text);
        const p = pickPlan(inner);
        if (p) return p;
      }
      return o;
    }
  }
  // Search inside nested text/parts fields.
  for (const o of objects) {
    for (const key of ["text", "content", "result", "message", "response"]) {
      if (typeof o?.[key] === "string") {
        const inner = extractJsonObjects(o[key]);
        const p = pickPlan(inner);
        if (p) return p;
      }
    }
  }
  return null;
}

export type VisionResult =
  | { ok: true; plan: DesignPlan }
  | { ok: false; error: string; rawTail?: string };

/**
 * OpenCode's CLI stalls when its stdout/stderr are pipes (the child serve
 * process never finishes), so run it with output redirected to temp files.
 */
function runVision(args: string[], workspace: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const base = path.join(os.tmpdir(), `dukan-vision-${crypto.randomUUID()}`);
    const outPath = `${base}.out`;
    const errPath = `${base}.err`;
    const outFd = fs.openSync(outPath, "w");
    const errFd = fs.openSync(errPath, "w");
    const child = spawn(OPENCODE_BIN, args, {
      cwd: workspace,
      stdio: ["ignore", outFd, errFd],
      env: { ...process.env, HOME: process.env.HOME || "/home/builder" },
    });
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.closeSync(outFd); } catch { /* already closed */ }
      try { fs.closeSync(errFd); } catch { /* already closed */ }
      const read = (p: string) => {
        try { return fs.readFileSync(p, "utf8").slice(-4 * 1024 * 1024); } catch { return ""; }
      };
      const stdout = read(outPath);
      const stderr = read(errPath);
      fs.rmSync(outPath, { force: true });
      fs.rmSync(errPath, { force: true });
      if (err) reject(err);
      else resolve({ stdout, stderr, timedOut });
    };
    child.on("error", (e) => finish(e));
    child.on("close", () => finish());
  });
}

/**
 * Analyze an uploaded design reference with the vision model. The image must be
 * readable by the agent process (worker copies it into the workspace first).
 */
export async function analyzeDesign(imagePath: string, workspace: string): Promise<VisionResult> {
  if (!fs.existsSync(imagePath)) return { ok: false, error: "design image missing" };
  if (!VISION_MODELS.length) {
    return { ok: false, error: "no usable vision models — every model in OPENCODE_VISION_MODELS is missing its provider key" };
  }

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 0; attempt < VISION_MODELS.length; attempt++) {
    const model = VISION_MODELS[attempt];
    const timeoutMs = attempt === 0 ? 240_000 : 150_000;
    try {
      const { stdout, stderr, timedOut } = await runVision(
        ["run", "--standalone", "-m", model, "--format", "json", "--file", imagePath, VISION_PROMPT],
        workspace,
        timeoutMs
      );
      if (timedOut) {
        lastError = `vision model ${model} timed out after ${timeoutMs / 1000}s`;
        continue;
      }
      const output = `${stdout || ""}\n${stderr || ""}`;
      const candidate = pickPlan(extractJsonObjects(output));
      if (!candidate) {
        lastError = "vision model did not return a parsable design plan";
        lastRaw = output.slice(-800);
        continue;
      }

      const sections: PlanSection[] = Array.isArray(candidate.sections)
        ? candidate.sections
            .filter((s: any) => s && typeof s === "object")
            .map((s: any) => ({
              name: asString(s.name, 40),
              description: asString(s.description, 400),
              text_content: asString(s.text_content, 400),
            }))
            .filter((s: PlanSection) => s.name)
            .slice(0, 10)
        : [];

      const palette = Array.isArray(candidate.color_palette)
        ? candidate.color_palette.map(normalizeHex).filter((x: string | null): x is string => !!x)
        : [];

      const plan: DesignPlan = {
        site_title: asString(candidate.site_title, 120),
        design_prompt: asString(candidate.design_prompt, 2000),
        style: asString(candidate.style, 120),
        layout_description: asString(candidate.layout_description, 400),
        sections,
        color_palette: Array.from(new Set(palette)).slice(0, 8) as string[],
        typography: asString(candidate.typography, 200),
        image_queries: asStringArray(candidate.image_queries, 8, 80),
        video_queries: asStringArray(candidate.video_queries, 3, 80),
        model,
        analyzed_at: new Date().toISOString(),
      };

      if (!plan.design_prompt && sections.length === 0 && plan.color_palette.length === 0) {
        lastError = "vision plan was empty";
        continue;
      }
      if (!plan.design_prompt) {
        plan.design_prompt = [plan.layout_description, plan.style, plan.typography]
          .filter(Boolean)
          .join(". ")
          .slice(0, 2000);
      }
      return { ok: true, plan };
    } catch (e: any) {
      lastError = e?.killed ? `vision model timed out after ${timeoutMs / 1000}s` : String(e?.message || e);
    }
  }
  return { ok: false, error: lastError || "vision analysis failed", rawTail: lastRaw || undefined };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function saturation(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function paletteFromPlan(plan: DesignPlan | null): { primary: string; accent: string; bg: string } | null {
  const colors = plan?.color_palette || [];
  if (colors.length < 2) return null;
  // The vision prompt asks for the palette "ordered from dominant to accent",
  // so the first colour is the brand colour. Only when that colour is
  // near-white do we fall back to the darkest colour as the primary.
  let primary = colors[0];
  if (luminance(primary) > 0.65) {
    primary = [...colors].sort((a, b) => luminance(a) - luminance(b))[0];
  }
  const bg = [...colors].sort((a, b) => luminance(b) - luminance(a))[0];
  const rest = colors.filter((c) => c !== primary && c !== bg);
  const accent =
    (rest.length ? rest : colors.filter((c) => c !== primary))
      .filter((c) => luminance(c) > 0.08 && luminance(c) < 0.9)
      .sort((a, b) => saturation(b) - saturation(a))[0] || rest[0] || primary;
  if (primary === bg) return null;
  return { primary, accent, bg };
}
