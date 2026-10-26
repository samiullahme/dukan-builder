import { NextResponse } from "next/server";
import { publicOrigin, supabaseServer } from "@/lib/auth";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/reset-password";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/reset-password";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (nextPath.startsWith("/reset-password")) {
    const dest = new URL(nextPath, origin);
    if (code) dest.searchParams.set("code", code);
    if (tokenHash) dest.searchParams.set("token_hash", tokenHash);
    if (type) dest.searchParams.set("type", type);
    return NextResponse.redirect(dest);
  }

  const sb = await supabaseServer();
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
    }
  } else if (tokenHash) {
    const otpType =
      type === "recovery" || type === "magiclink" || type === "email" || type === "signup"
        ? type
        : "recovery";
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (error) {
      return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
    }
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}
