import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth";
import { get } from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const INVALID_LINK_MSG =
  "This password reset link is invalid or has expired. Please request a new one.";

export async function POST(req: Request) {
  if (!(await takeToken(`reset-password:${clientIp(req)}`, 10, 10 / 600))) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pw = String(body.password ?? "");
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const tokenHash = typeof body.token_hash === "string" ? body.token_hash.trim() : "";
  const rawType = typeof body.type === "string" ? body.type.trim() : "";
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";

  if (pw.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (pw.length > 72) {
    return NextResponse.json(
      { error: "Password must be 72 characters or fewer." },
      { status: 400 }
    );
  }

  const sb = await supabaseServer();

  if (code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      return NextResponse.json({ error: INVALID_LINK_MSG }, { status: 400 });
    }
  } else if (tokenHash) {
    const otpType =
      rawType === "recovery" || rawType === "magiclink" || rawType === "email"
        ? rawType
        : "recovery";
    const { data, error } = await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error || !data.session) {
      return NextResponse.json({ error: INVALID_LINK_MSG }, { status: 400 });
    }
  } else if (accessToken && refreshToken) {
    const { data, error } = await sb.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data.session) {
      return NextResponse.json({ error: INVALID_LINK_MSG }, { status: 400 });
    }
  }

  let user: { id: string } | null = null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (!error) user = data.user;
  } catch {
    user = null;
  }
  if (!user) {
    return NextResponse.json({ error: INVALID_LINK_MSG }, { status: 401 });
  }

  const profile = await get<{ status: string }>(
    "SELECT status FROM profiles WHERE id = ?",
    user.id
  );
  if (profile?.status === "suspended") {
    await sb.auth.signOut();
    return NextResponse.json(
      { error: "This account has been suspended." },
      { status: 403 }
    );
  }

  const { error: updateErr } = await sb.auth.updateUser({ password: pw });
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message || "Could not update your password. Please try again." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
