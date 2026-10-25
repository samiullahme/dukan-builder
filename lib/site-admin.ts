import crypto from "crypto";
import db from "./db";

const PW_LOWER = "abcdefghjkmnpqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PW_DIGITS = "23456789";
const PW_ALPHABET = PW_LOWER + PW_UPPER + PW_DIGITS;

export const CREDENTIALS_UNLOCK_HOURS = 12;

// ---- TOTP (RFC 6238, Google Authenticator compatible) ----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of buf) {
    acc = ((acc << 8) | b) & 0xffffffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("invalid base32 secret");
    acc = ((acc << 5) | v) & 0xffffffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function totpAt(secretB32: string, seconds: number, digits = 6): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(seconds / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin =
    ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Accepts codes from the current and adjacent 30s windows. */
export function verifyTotp(secretB32: string, code: string): boolean {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const now = Math.floor(Date.now() / 1000);
  for (let off = -1; off <= 1; off++) {
    if (totpAt(secretB32, now + off * 30) === c) return true;
  }
  return false;
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`DukanBuilder:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=DukanBuilder&algorithm=SHA1&digits=6&period=30`;
}

// ---- Secret encryption (AES-256-GCM, key from env) ----

function encKey(): Buffer {
  const k = process.env.SITE_ADMIN_ENC_KEY;
  if (!k) throw new Error("SITE_ADMIN_ENC_KEY is not set");
  const buf = Buffer.from(k.replace(/[^0-9a-fA-F]/g, ""), "hex");
  if (buf.length !== 32) throw new Error("SITE_ADMIN_ENC_KEY must be 32 bytes of hex");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

export function decryptSecret(blob: string): string {
  const [ivh, tagh, cth] = blob.split(".");
  if (!ivh || !tagh || !cth) throw new Error("credential blob is malformed");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivh, "hex"));
  d.setAuthTag(Buffer.from(tagh, "hex"));
  return Buffer.concat([d.update(Buffer.from(cth, "hex")), d.final()]).toString("utf8");
}

// ---- Owner credentials ----

export function generatePassword(len = 14): string {
  const bytes = crypto.randomBytes(len);
  const s = Array.from({ length: len }, (_, i) => PW_ALPHABET[bytes[i] % PW_ALPHABET.length]).join("");
  // Guarantee at least one lowercase, one uppercase and one digit.
  return (
    PW_LOWER[bytes[0] % PW_LOWER.length] +
    PW_UPPER[bytes[1] % PW_UPPER.length] +
    PW_DIGITS[bytes[2] % PW_DIGITS.length] +
    s.slice(3)
  );
}

export type SiteCredential = { username: string; password: string };

export async function ensureSiteCredential(siteId: string, slug: string): Promise<SiteCredential> {
  const existing = await db
    .prepare("SELECT username, password_enc FROM site_admins WHERE site_id = ?")
    .get<{ username: string; password_enc: string }>(siteId);
  if (existing) return { username: existing.username, password: decryptSecret(existing.password_enc) };
  const credential = { username: slug, password: generatePassword() };
  await db
    .prepare(
      "INSERT INTO site_admins (id, site_id, username, password_enc) VALUES (?,?,?,?) ON CONFLICT (site_id) DO NOTHING"
    )
    .run(crypto.randomUUID(), siteId, credential.username, encryptSecret(credential.password));
  return credential;
}

export async function rotateSiteCredential(siteId: string): Promise<SiteCredential> {
  const row = await db
    .prepare("SELECT username FROM site_admins WHERE site_id = ?")
    .get<{ username: string }>(siteId);
  if (!row) throw new Error("no credential for this site");
  const password = generatePassword();
  await db.prepare("UPDATE site_admins SET password_enc = ? WHERE site_id = ?").run(encryptSecret(password), siteId);
  return { username: row.username, password };
}

export async function readSiteCredential(siteId: string): Promise<SiteCredential | null> {
  const row = await db
    .prepare("SELECT username, password_enc FROM site_admins WHERE site_id = ?")
    .get<{ username: string; password_enc: string }>(siteId);
  if (!row) return null;
  return { username: row.username, password: decryptSecret(row.password_enc) };
}

// ---- Account TOTP state ----

function dbTimeToMs(value: string | null): number {
  return value ? Date.parse(value.replace(" ", "T") + "Z") : 0;
}

export type TotpStatus = { enabled: boolean; unlocked_until: string | null };

export async function getTotpStatus(userId: string): Promise<TotpStatus> {
  const row = await db
    .prepare("SELECT totp_enabled, credentials_unlocked_until FROM profiles WHERE id = ?")
    .get<{ totp_enabled: number; credentials_unlocked_until: string | null }>(userId);
  return {
    enabled: !!row?.totp_enabled,
    unlocked_until: row?.credentials_unlocked_until ?? null,
  };
}

export async function isCredentialsUnlocked(userId: string): Promise<boolean> {
  const s = await getTotpStatus(userId);
  return s.enabled && dbTimeToMs(s.unlocked_until) > Date.now();
}

export async function setupTotp(userId: string, email: string): Promise<{ secret: string; otpauth: string }> {
  const secret = generateTotpSecret();
  await db
    .prepare("UPDATE profiles SET totp_secret = ?, totp_enabled = false, credentials_unlocked_until = null WHERE id = ?")
    .run(secret, userId);
  return { secret, otpauth: otpauthUrl(secret, email) };
}

export async function confirmTotp(userId: string, code: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT totp_secret FROM profiles WHERE id = ?")
    .get<{ totp_secret: string | null }>(userId);
  if (!row?.totp_secret) return false;
  if (!verifyTotp(row.totp_secret, code)) return false;
  await db.prepare("UPDATE profiles SET totp_enabled = true WHERE id = ?").run(userId);
  return true;
}

export async function unlockWithTotp(userId: string, code: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT totp_secret, totp_enabled FROM profiles WHERE id = ?")
    .get<{ totp_secret: string | null; totp_enabled: number }>(userId);
  if (!row?.totp_enabled || !row.totp_secret) return false;
  if (!verifyTotp(row.totp_secret, code)) return false;
  await db
    .prepare(
      `UPDATE profiles SET credentials_unlocked_until = now() + interval '${CREDENTIALS_UNLOCK_HOURS} hours' WHERE id = ?`
    )
    .run(userId);
  return true;
}
