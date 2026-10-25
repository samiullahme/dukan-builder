import crypto from "crypto";
import db from "@/lib/db";
import { verifySiteToken } from "@/app/api/site-auth/route";

export type SiteRequestRow = {
  id: string;
  site_id: string;
  ref: string;
  type: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  fields: Record<string, string>;
  sample: boolean;
  created_at: string;
};

export type SiteSubscriberRow = {
  id: string;
  site_id: string;
  email: string;
  name: string;
  sample: boolean;
  created_at: string;
};

export const REQUEST_TYPES = ["booking", "inquiry"] as const;

export const ALLOWED_STATUS: Record<string, string[]> = {
  booking: ["new", "confirmed", "completed", "cancelled"],
  inquiry: ["new", "handled", "closed"],
};

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || "unknown";
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

/** db.ts returns timestamptz as "YYYY-MM-DD HH:MM:SS" UTC; convert to ISO. */
export function iso(ts: string): string {
  const d = new Date(String(ts).replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? String(ts) : d.toISOString();
}

export function makeRef(type: string): string {
  const prefix = type === "booking" ? "BK" : type === "inquiry" ? "IN" : "RQ";
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

export function toRequestJson(row: SiteRequestRow) {
  return {
    id: row.id,
    ref: row.ref,
    type: row.type,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    fields: row.fields ?? {},
    sample: row.sample,
    createdAt: iso(row.created_at),
  };
}

export function toSubscriberJson(row: SiteSubscriberRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    sample: row.sample,
    createdAt: iso(row.created_at),
  };
}

export async function siteIdBySlug(slug: string): Promise<string | null> {
  const site = await db.prepare("SELECT id FROM sites WHERE slug = ?").get<{ id: string }>(slug);
  return site ? site.id : null;
}

/** Owner identity from either ?token= (GET) or JSON {token} (mutations). */
export async function ownerFrom(req: Request): Promise<{ site_id: string; username: string } | null> {
  let token = new URL(req.url).searchParams.get("token") || "";
  if (!token && (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) {
    try {
      const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
      token = String(body.token || "");
    } catch {
      token = "";
    }
  }
  if (!token) return null;
  return verifySiteToken(token);
}

const SAMPLE_REQUESTS = [
  {
    ref: "BK-SAMPLE",
    type: "booking",
    name: "Sana Malik",
    email: "sana.sample@example.com",
    phone: "0300 1234567",
    message: "Please confirm the time and let me know if you need anything else from me.",
    fields: {},
    ageDays: 2,
  },
  {
    ref: "IN-SAMPLE",
    type: "inquiry",
    name: "Usman Raza",
    email: "usman.sample@example.com",
    phone: "0321 7654321",
    message: "I would like to know more about your services and availability this week.",
    fields: {},
    ageDays: 1,
  },
];

/** Seed the demo rows once per site so a fresh owner dashboard is not empty. */
export async function seedSamplesIfNeeded(siteId: string): Promise<void> {
  const claimed = await db
    .prepare("UPDATE sites SET data_seeded = true WHERE id = ? AND data_seeded = false")
    .run(siteId);
  if (!claimed.changes) return;
  try {
    for (const s of SAMPLE_REQUESTS) {
      await db
        .prepare(
          `INSERT INTO site_requests (id, site_id, ref, type, status, name, email, phone, message, fields, sample, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?,?)`
        )
        .run(
          crypto.randomUUID(),
          siteId,
          s.ref,
          s.type,
          "new",
          s.name,
          s.email,
          s.phone,
          s.message,
          JSON.stringify(s.fields),
          true,
          new Date(Date.now() - s.ageDays * 864e5).toISOString()
        );
    }
    await db
      .prepare(
        `INSERT INTO site_subscribers (id, site_id, email, name, sample, created_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT (site_id, email) DO NOTHING`
      )
      .run(crypto.randomUUID(), siteId, "hira.sample@example.com", "Hira Shah", true, new Date(Date.now() - 3 * 864e5).toISOString());
  } catch {
    await db.prepare("UPDATE sites SET data_seeded = false WHERE id = ?").run(siteId);
  }
}
