import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getUser } from "@/lib/auth";
import { takeToken } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/admin";
import {
  getTotpStatus,
  setupTotp,
  confirmTotp,
  unlockWithTotp,
  CREDENTIALS_UNLOCK_HOURS,
} from "@/lib/site-admin";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await getTotpStatus(user.id));
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const code = String(body.code || "").replace(/\s/g, "");

  if (action === "setup") {
    if (!(await takeToken(`totp-setup:${user.id}`, 5, 5 / 3600))) {
      return NextResponse.json({ error: "Too many setup attempts. Try again later." }, { status: 429 });
    }
    const status = await getTotpStatus(user.id);
    if (status.enabled) {
      return NextResponse.json({ error: "2FA is already enabled on this account." }, { status: 400 });
    }
    const { secret, otpauth } = await setupTotp(user.id, user.email);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauth, qr });
  }

  if (action === "confirm") {
    if (!(await takeToken(`totp-confirm:${user.id}`, 20, 20 / 3600))) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (!(await confirmTotp(user.id, code))) {
      return NextResponse.json({ error: "That code is not correct." }, { status: 400 });
    }
    await writeAudit(user, "totp_enabled", "user", user.id, null, null);
    return NextResponse.json({ ok: true });
  }

  if (action === "unlock") {
    if (!(await takeToken(`totp-unlock:${user.id}`, 20, 20 / 3600))) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (!(await unlockWithTotp(user.id, code))) {
      return NextResponse.json({ error: "That code is not correct." }, { status: 400 });
    }
    await writeAudit(user, "credentials_unlocked", "user", user.id, null, null);
    const status = await getTotpStatus(user.id);
    return NextResponse.json({ ok: true, unlocked_until: status.unlocked_until, hours: CREDENTIALS_UNLOCK_HOURS });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
