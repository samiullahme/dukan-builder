import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, fakeDb } = vi.hoisted(() => {
  const state = {
    mockRows: [] as any[],
    siteExists: true,
    allowRateLimit: true,
    lastSql: "",
    lastParams: [] as any[],
  };
  const fakeDb = {
    prepare: (sql: string) => ({
      get: async (_slug: string) => {
        if (!state.siteExists) return undefined;
        return { id: "site-123" };
      },
      all: async (...params: any[]) => {
        state.lastSql = sql;
        state.lastParams = params;
        return state.mockRows;
      },
    }),
  };
  return { state, fakeDb };
});

vi.mock("../lib/db", () => ({
  default: fakeDb,
}));

vi.mock("@/lib/db", () => ({
  default: fakeDb,
}));

vi.mock("@/app/api/site-auth/route", () => ({
  verifySiteToken: vi.fn(),
}));

vi.mock("../lib/ratelimit", () => ({
  takeToken: vi.fn(async () => state.allowRateLimit),
}));

vi.mock("@/lib/ratelimit", () => ({
  takeToken: vi.fn(async () => state.allowRateLimit),
}));

import { POST } from "../app/api/site-data/lookup/route";

function makeReq(body: any, ip = "127.0.0.1") {
  return new Request("http://localhost:3000/api/site-data/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("site-data lookup endpoint", () => {
  beforeEach(() => {
    state.mockRows.length = 0;
    state.siteExists = true;
    state.allowRateLimit = true;
    state.lastSql = "";
    state.lastParams = [];
  });

  it("returns 429 when rate limit is exceeded", async () => {
    state.allowRateLimit = false;
    const res = await POST(makeReq({ slug: "my-shop", email: "test@example.com", refs: ["BK-123456"] }));
    expect(res.status).toBe(429);
  });

  it("returns 400 when email is invalid or slug is missing", async () => {
    const res1 = await POST(makeReq({ slug: "", email: "test@example.com", refs: ["BK-123456"] }));
    expect(res1.status).toBe(400);

    const res2 = await POST(makeReq({ slug: "my-shop", email: "not-an-email", refs: ["BK-123456"] }));
    expect(res2.status).toBe(400);
  });

  it("returns 404 when site slug is not found", async () => {
    state.siteExists = false;
    const res = await POST(makeReq({ slug: "unknown-site", email: "test@example.com", refs: ["BK-123456"] }));
    expect(res.status).toBe(404);
  });

  it("returns empty list if refs array is empty or has invalid refs", async () => {
    const res = await POST(makeReq({ slug: "my-shop", email: "test@example.com", refs: [] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, requests: [] });
  });

  it("normalizes email to lowercase and limits refs to 20 using IN (?, ...)", async () => {
    const refs = Array.from({ length: 25 }, (_, i) => `BK-REF${i.toString().padStart(4, "0")}`);
    state.mockRows.push({
      id: "req-1",
      ref: "BK-REF0000",
      type: "booking",
      status: "confirmed",
      created_at: "2026-10-26 12:00:00",
      fields: JSON.stringify({ service: "Haircut" }),
      name: "Secret Name",
      phone: "03001234567",
      message: "Secret note",
    });

    const res = await POST(makeReq({ slug: "my-shop", email: "TeSt.UsEr@ExAmPlE.cOm", refs }));
    expect(res.status).toBe(200);

    // Email was lowercased
    expect(state.lastParams[1]).toBe("test.user@example.com");

    // Refs were limited to 20
    expect(state.lastParams.slice(2)).toHaveLength(20);

    // IN (?, ...) has 20 placeholders
    const inPart = state.lastSql.match(/ref IN \(([^)]+)\)/)?.[1];
    expect(inPart?.split(",").length).toBe(20);

    // Whitelist check: only safe fields returned, no name/phone/message
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0]).toEqual({
      id: "req-1",
      ref: "BK-REF0000",
      type: "booking",
      status: "confirmed",
      createdAt: expect.any(String),
      fields: { service: "Haircut" },
    });
    expect(data.requests[0].name).toBeUndefined();
    expect(data.requests[0].phone).toBeUndefined();
    expect(data.requests[0].message).toBeUndefined();
  });
});
