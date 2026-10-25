import crypto from "crypto";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";
import { decryptSecret } from "@/lib/site-admin";

const TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const TOKEN_VERSION = "v1";

function signingKey(): Buffer {
  const encKey = process.env.SITE_ADMIN_ENC_KEY;
  if (!encKey) throw new Error("SITE_ADMIN_ENC_KEY is not set");
  return crypto.createHash("sha256").update(`dukan-site-auth-v1:${encKey}`).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", signingKey()).update(payload).digest());
}

function issueToken(siteId: string, username: string): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ sid: siteId, un: username, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }))
  );
  return `${TOKEN_VERSION}.${payload}.${sign(payload)}`;
}

export function verifySiteToken(token: string): { site_id: string; username: string } | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, payload, sig] = parts;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let parsed: { sid?: string; un?: string; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed.sid || !parsed.un || typeof parsed.exp !== "number" || parsed.exp < Date.now() / 1000) return null;
  return { site_id: parsed.sid, username: parsed.un };
}

const sha256 = (value: string): Buffer => crypto.createHash("sha256").update(value, "utf8").digest();

function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || "unknown";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!slug || !username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }
  const ip = clientIp(req);
  if (!(await takeToken(`site-auth-ip:${ip}`, 30, 30 / 3600))) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 });
  }
  if (!(await takeToken(`site-auth:${ip}:${slug}`, 10, 10 / 3600))) {
    return NextResponse.json({ error: "Too many sign-in attempts for this site. Try again later." }, { status: 429 });
  }

  const site = await db.prepare("SELECT id FROM sites WHERE slug = ?").get<{ id: string }>(slug);
  if (!site) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  const row = await db
    .prepare("SELECT username, password_enc FROM site_admins WHERE site_id = ?")
    .get<{ username: string; password_enc: string }>(site.id);
  if (!row) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const userOk = safeEqual(username, row.username);
  let passOk = false;
  try {
    passOk = safeEqual(password, decryptSecret(row.password_enc));
  } catch {
    passOk = false;
  }
  if (!userOk || !passOk) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  return NextResponse.json({ token: issueToken(site.id, row.username), username: row.username });
}
