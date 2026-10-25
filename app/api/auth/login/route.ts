import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth";
import { get } from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  if (!(await takeToken(`login:${clientIp(req)}`, 10, 10 / 600))) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }
  const { email, password } = (await req.json().catch(() => ({}))) as any;
  const em = String(email ?? "").trim().toLowerCase();

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithPassword({ email: em, password });
  if (error || !data.session) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const profile = await get<{ status: string }>("SELECT status FROM profiles WHERE id = ?", data.session.user.id);
  if (profile?.status === "suspended") {
    await sb.auth.signOut();
    return NextResponse.json({ error: "This account has been suspended." }, { status: 403 });
  }
  await sb.auth.setSession(data.session);
  return NextResponse.json({ ok: true });
}
