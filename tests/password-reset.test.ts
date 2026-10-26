import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = {
  resetPasswordForEmail: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("../lib/db", () => ({
  get: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  get: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");
  return {
    ...actual,
    supabaseServer: vi.fn(async () => ({ auth: mockAuth })),
  };
});

vi.mock("@/lib/ratelimit", () => ({
  takeToken: vi.fn(),
}));

import { publicOrigin } from "@/lib/auth";
import { get } from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";
import { POST as forgotPasswordPOST } from "../app/api/auth/forgot-password/route";
import { POST as resetPasswordPOST } from "../app/api/auth/reset-password/route";
import { GET as authCallbackGET } from "../app/auth/callback/route";

describe("password reset routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(takeToken).mockResolvedValue(true);
    vi.mocked(get).mockResolvedValue({ status: "active" });
    mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "at", refresh_token: "rt" } },
      error: null,
    });
    mockAuth.verifyOtp.mockResolvedValue({
      data: { session: { access_token: "at", refresh_token: "rt" } },
      error: null,
    });
    mockAuth.setSession.mockResolvedValue({
      data: { session: { access_token: "at", refresh_token: "rt" } },
      error: null,
    });
    mockAuth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "shop@example.com" } },
      error: null,
    });
    mockAuth.updateUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });
    mockAuth.signOut.mockResolvedValue({ error: null });
  });

  describe("POST /api/auth/forgot-password", () => {
    it("rejects invalid email addresses with 400", async () => {
      const req = new Request("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      const res = await forgotPasswordPOST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Enter a valid email address." });
      expect(mockAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("sends a password reset email with a safe redirectTo URL", async () => {
      const req = new Request("http://127.0.0.1:3010/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-host": "builder.lanesite.pro",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ email: "  Owner@Shop.pk " }),
      });
      const res = await forgotPasswordPOST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith("owner@shop.pk", {
        redirectTo: "https://builder.lanesite.pro/reset-password",
      });
    });

    it("ignores untrusted x-forwarded-host headers to prevent host header poisoning", () => {
      const req = new Request("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "x-forwarded-host": "evil.attacker.com",
          "x-forwarded-proto": "https",
        },
      });
      expect(publicOrigin(req)).toBe("http://localhost:3000");
    });

    it("does not send reset email for suspended users but still returns ok: true", async () => {
      vi.mocked(get).mockResolvedValueOnce({ status: "suspended" });
      const req = new Request("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "suspended@shop.pk" }),
      });
      const res = await forgotPasswordPOST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("returns 429 when rate limited", async () => {
      vi.mocked(takeToken).mockResolvedValueOnce(false);
      const req = new Request("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@shop.pk" }),
      });
      const res = await forgotPasswordPOST(req);
      expect(res.status).toBe(429);
    });
  });

  describe("POST /api/auth/reset-password", () => {
    it("rejects passwords shorter than 8 characters", async () => {
      const req = new Request("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "short", code: "pkce-code" }),
      });
      const res = await resetPasswordPOST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Password must be at least 8 characters.",
      });
      expect(mockAuth.updateUser).not.toHaveBeenCalled();
    });

    it("exchanges PKCE code and updates the user password", async () => {
      const req = new Request("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "newStrongPassword123", code: "pkce-code-abc" }),
      });
      const res = await resetPasswordPOST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code-abc");
      expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: "newStrongPassword123" });
    });

    it("verifies token_hash recovery token and updates password", async () => {
      const req = new Request("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "newStrongPassword123",
          token_hash: "th-xyz",
          type: "recovery",
        }),
      });
      const res = await resetPasswordPOST(req);
      expect(res.status).toBe(200);
      expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
        token_hash: "th-xyz",
        type: "recovery",
      });
      expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: "newStrongPassword123" });
    });

    it("blocks suspended users from resetting their password", async () => {
      vi.mocked(get).mockResolvedValueOnce({ status: "suspended" });
      const req = new Request("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "newStrongPassword123", code: "pkce-code-abc" }),
      });
      const res = await resetPasswordPOST(req);
      expect(res.status).toBe(403);
      expect(mockAuth.signOut).toHaveBeenCalled();
      expect(mockAuth.updateUser).not.toHaveBeenCalled();
    });
  });

  describe("GET /auth/callback", () => {
    it("forwards recovery code to /reset-password and blocks open redirects", async () => {
      const req = new Request(
        "http://localhost:3000/auth/callback?code=rec-123&next=//evil.com"
      );
      const res = await authCallbackGET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/reset-password?code=rec-123"
      );
      expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
    });
  });
});
