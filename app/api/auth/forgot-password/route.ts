import { NextResponse } from "next/server";
import { publicOrigin, supabaseServer } from "@/lib/auth";
import { get } from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  if (!(await takeToken(`forgot-password:${clientIp(req)}`, 5, 5 / 3600))) {
    return NextResponse.json(
      { error: "Too many reset requests. Please try again later." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const em = String(body.email ?? "").trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!(await takeToken(`forgot-password-email:${em}`, 3, 3 / 3600))) {
    return NextResponse.json(
      { error: "Too many reset requests. Please try again later." },
      { status: 429 }
    );
  }

  const profile = await get<{ status: string }>(
    "SELECT status FROM profiles WHERE email = ?",
    em
  );
  if (profile?.status === "suspended") {
    return NextResponse.json({ ok: true });
  }

  const sb = await supabaseServer();
  const redirectTo = `${publicOrigin(req)}/reset-password`;
  const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo });
  if (error && error.status === 429) {
    return NextResponse.json(
      { error: "Too many reset requests. Please try again later." },
      { status: 429 }
    );
  }

  return NextResponse.json({ ok: true });
}
