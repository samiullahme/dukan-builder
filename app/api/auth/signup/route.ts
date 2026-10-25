import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth";
import { takeToken } from "@/lib/ratelimit";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  if (!(await takeToken(`signup:${clientIp(req)}`, 5, 5 / 3600))) {
    return NextResponse.json({ error: "Too many signups. Please try again later." }, { status: 429 });
  }
  const { email, password } = (await req.json().catch(() => ({}))) as any;
  const em = String(email ?? "").trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (String(password ?? "").length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({ email: em, password });
  if (error) {
    if (error.status === 422 || error.code === "user_already_exists")
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    return NextResponse.json({ error: "Could not create the account. Please try again." }, { status: 400 });
  }
  if (data.session) await sb.auth.setSession(data.session);
  return NextResponse.json({ ok: true }, { status: 201 });
}
