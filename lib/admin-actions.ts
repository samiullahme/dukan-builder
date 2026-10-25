import crypto from "crypto";
import fs from "fs";
import path from "path";
import { get, query, run } from "./db";
import { supabaseService } from "./auth";
import { writeAudit } from "./admin";
import { chmodRecursive, copyWorkspaceNoSymlinks, sanitizeWorkspace } from "./workspace-security";
import { removeWorkspace } from "./provision";
import type { User } from "./auth";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";
const PUBLISHED_ROOT = process.env.PUBLISHED_ROOT || "/opt/www/published";

export type ActionResult = { ok: boolean; error?: string };

export class AdminActionError extends Error {}

// ---- Users ----

export async function suspendUser(actor: User, userId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const target = await get<{ email: string }>("SELECT email FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    if (userId === actor.id) throw new AdminActionError("You cannot suspend your own account.");
    await run(`UPDATE profiles SET status = 'suspended' WHERE id = ?`, userId);
    const sb = supabaseService();
    const users = await sb.auth.admin.listUsers();
    const authUser = users.data?.users?.find((u) => u.email === target.email);
    if (authUser) {
      await sb.auth.admin.updateUserById(authUser.id, { ban_duration: "876600h" });
    }
    await writeAudit(actor, "user.suspend", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not suspend the user." };
  }
}

export async function reactivateUser(actor: User, userId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const target = await get<{ email: string }>("SELECT email FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    await run(`UPDATE profiles SET status = 'active' WHERE id = ?`, userId);
    const sb = supabaseService();
    const users = await sb.auth.admin.listUsers();
    const authUser = users.data?.users?.find((u) => u.email === target.email);
    if (authUser) {
      await sb.auth.admin.updateUserById(authUser.id, { ban_duration: "none" });
    }
    await writeAudit(actor, "user.reactivate", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reactivate the user." };
  }
}

export async function setUserRole(actor: User, userId: string, isAdmin: boolean, reason: string | null = null): Promise<ActionResult> {
  try {
    const target = await get<{ email: string }>("SELECT email FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    if (userId === actor.id && !isAdmin) throw new AdminActionError("You cannot remove your own admin role.");
    await run(`UPDATE profiles SET is_admin = ? WHERE id = ?`, isAdmin ? 1 : 0, userId);
    await writeAudit(actor, isAdmin ? "user.make_admin" : "user.remove_admin", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not change the user's role." };
  }
}

export async function setUserQuota(actor: User, userId: string, buildsAllowed: number, reason: string | null = null): Promise<ActionResult> {
  try {
    const target = await get<{ id: string }>("SELECT id FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    if (!Number.isFinite(buildsAllowed) || buildsAllowed < 0 || buildsAllowed > 1000) {
      throw new AdminActionError("Quota must be a number between 0 and 1000.");
    }
    await run(
      `INSERT INTO quota (user_id, builds_used, builds_allowed) VALUES (?, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET builds_allowed = excluded.builds_allowed`,
      userId,
      Math.round(buildsAllowed)
    );
    await writeAudit(actor, "user.set_quota", "user", userId, reason || `allowed=${buildsAllowed}`, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not update the quota." };
  }
}

export async function resetUserPassword(actor: User, userId: string, tempPassword: string, reason: string | null = null): Promise<ActionResult> {
  try {
    if (!/^.{10,72}$/.test(tempPassword)) {
      throw new AdminActionError("The temporary password must be at least 10 characters.");
    }
    const target = await get<{ email: string }>("SELECT email FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    const sb = supabaseService();
    const users = await sb.auth.admin.listUsers();
    const authUser = users.data?.users?.find((u) => u.email === target.email);
    if (!authUser) throw new AdminActionError("No auth account exists for this user yet.");
    const { error } = await sb.auth.admin.updateUserById(authUser.id, { password: tempPassword });
    if (error) throw new AdminActionError(error.message);
    await writeAudit(actor, "user.reset_password", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reset the password." };
  }
}

export async function deleteUser(actor: User, userId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    if (userId === actor.id) throw new AdminActionError("You cannot delete your own account.");
    const target = await get<{ email: string }>("SELECT email FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");

    const sites = await query<{ slug: string }>("SELECT slug FROM sites WHERE user_id = ?", [userId]);
    for (const { slug } of sites.rows) {
      try { removeWorkspace(userId, slug); } catch { /* best effort */ }
      fs.rmSync(path.join(PUBLISHED_ROOT, slug), { recursive: true, force: true });
    }

    await run(`DELETE FROM chat_messages WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId);
    await run(`DELETE FROM builds WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId);
    await run(`DELETE FROM briefs WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId);
    await run(`DELETE FROM site_flags WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId);
    await run(`DELETE FROM sites WHERE user_id = ?`, userId);
    await run(`DELETE FROM quota WHERE user_id = ?`, userId);
    await run(`DELETE FROM profiles WHERE id = ?`, userId);

    const sb = supabaseService();
    const users = await sb.auth.admin.listUsers();
    const authUser = users.data?.users?.find((u) => u.email === target.email);
    if (authUser) await sb.auth.admin.deleteUser(authUser.id);

    await writeAudit(actor, "user.delete", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not delete the user." };
  }
}

// ---- Sites ----

export async function unpublishSite(actor: User, siteId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const site = await get<{ slug: string; status: string }>("SELECT slug, status FROM sites WHERE id = ?", siteId);
    if (!site) throw new AdminActionError("Website not found.");
    if (site.status !== "published") throw new AdminActionError("This website is not published.");
    fs.rmSync(path.join(PUBLISHED_ROOT, site.slug), { recursive: true, force: true });
    await run(`UPDATE sites SET status = 'ready' WHERE id = ?`, siteId);
    await writeAudit(actor, "site.unpublish", "site", siteId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not unpublish the website." };
  }
}

export async function republishSite(actor: User, siteId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const site = await get<{ slug: string; status: string; user_id: string }>(
      "SELECT slug, status, user_id FROM sites WHERE id = ?",
      siteId
    );
    if (!site) throw new AdminActionError("Website not found.");
    if (site.status !== "ready" && site.status !== "published") {
      throw new AdminActionError("This website has no finished build to publish.");
    }
    const workspace = path.join(TENANTS_ROOT, site.user_id, site.slug);
    sanitizeWorkspace(workspace);
    if (!fs.existsSync(path.join(workspace, "index.html"))) {
      throw new AdminActionError("Workspace files are missing.");
    }
    const staging = path.join(PUBLISHED_ROOT, `.tmp-${site.slug}-${crypto.randomBytes(6).toString("hex")}`);
    const target = path.join(PUBLISHED_ROOT, site.slug);
    fs.mkdirSync(PUBLISHED_ROOT, { recursive: true });
    copyWorkspaceNoSymlinks(workspace, staging);
    for (const drop of ["opencode.json", "AGENTS.md", "design"]) {
      const p = path.join(staging, drop);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
    chmodRecursive(staging);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    await run(`UPDATE sites SET status = 'published' WHERE id = ?`, siteId);
    await writeAudit(actor, "site.republish", "site", siteId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not republish the website." };
  }
}

export async function transferSite(actor: User, siteId: string, newOwnerId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const site = await get<{ user_id: string }>("SELECT user_id FROM sites WHERE id = ?", siteId);
    if (!site) throw new AdminActionError("Website not found.");
    const newOwner = await get<{ id: string }>("SELECT id FROM profiles WHERE id = ?", newOwnerId);
    if (!newOwner) throw new AdminActionError("New owner not found.");
    if (newOwnerId === site.user_id) throw new AdminActionError("The website already belongs to this user.");
    await run(`UPDATE sites SET user_id = ? WHERE id = ?`, newOwnerId, siteId);
    await writeAudit(actor, "site.transfer", "site", siteId, reason || `to=${newOwnerId}`, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not transfer the website." };
  }
}

export async function deleteSite(actor: User, siteId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const site = await get<{ slug: string; user_id: string }>("SELECT slug, user_id FROM sites WHERE id = ?", siteId);
    if (!site) throw new AdminActionError("Website not found.");
    try { removeWorkspace(site.user_id, site.slug); } catch { /* best effort */ }
    fs.rmSync(path.join(PUBLISHED_ROOT, site.slug), { recursive: true, force: true });
    await run(`DELETE FROM chat_messages WHERE site_id = ?`, siteId);
    await run(`DELETE FROM builds WHERE site_id = ?`, siteId);
    await run(`DELETE FROM briefs WHERE site_id = ?`, siteId);
    await run(`DELETE FROM site_flags WHERE site_id = ?`, siteId);
    await run(`DELETE FROM sites WHERE id = ?`, siteId);
    await writeAudit(actor, "site.delete", "site", siteId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not delete the website." };
  }
}

// ---- Builds ----

export async function retryBuild(actor: User, buildId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const build = await get<{ site_id: string; kind: string; input: string | null; status: string }>(
      "SELECT site_id, kind, input, status FROM builds WHERE id = ?",
      buildId
    );
    if (!build) throw new AdminActionError("Build not found.");
    if (build.status !== "failed" && build.status !== "cancelled") {
      throw new AdminActionError("Only failed builds can be retried.");
    }
    const busy = await get<{ one: number }>(
      `SELECT 1 AS one FROM builds WHERE site_id = ? AND status IN ('queued','building') LIMIT 1`,
      build.site_id
    );
    if (busy) throw new AdminActionError("This website already has a build queued or running.");
    const newId = crypto.randomUUID();
    await run(
      `INSERT INTO builds (id, site_id, kind, input, status) VALUES (?,?,?,?,?)`,
      newId, build.site_id, build.kind, build.input ?? "", "queued"
    );
    await run(`UPDATE sites SET status = 'building' WHERE id = ?`, build.site_id);
    await writeAudit(actor, "build.retry", "build", buildId, reason || `new=${newId}`, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not retry the build." };
  }
}

export async function cancelBuild(actor: User, buildId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    const build = await get<{ site_id: string; status: string }>("SELECT site_id, status FROM builds WHERE id = ?", buildId);
    if (!build) throw new AdminActionError("Build not found.");
    if (build.status !== "queued" && build.status !== "building") {
      throw new AdminActionError("Only queued or running builds can be cancelled.");
    }
    await run(`UPDATE builds SET status = 'cancelled', finished_at = now() WHERE id = ?`, buildId);
    await run(`UPDATE sites SET status = 'draft' WHERE id = ?`, build.site_id);
    await writeAudit(actor, "build.cancel", "build", buildId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not cancel the build." };
  }
}

export async function markBuildReviewed(actor: User, buildId: string): Promise<ActionResult> {
  try {
    const build = await get<{ id: string }>("SELECT id FROM builds WHERE id = ?", buildId);
    if (!build) throw new AdminActionError("Build not found.");
    await run(`UPDATE builds SET reviewed = 1 WHERE id = ?`, buildId);
    await writeAudit(actor, "build.reviewed", "build", buildId, null, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not mark the build as reviewed." };
  }
}

// ---- Admins ----

export async function addAdmin(actor: User, email: string): Promise<ActionResult> {
  try {
    const target = await get<{ id: string; is_admin: number }>("SELECT id, is_admin FROM profiles WHERE email = ?", email.trim().toLowerCase());
    if (!target) throw new AdminActionError("No user with that email. They need to sign up first.");
    if (target.is_admin === 1) throw new AdminActionError("This user is already an admin.");
    await run(`UPDATE profiles SET is_admin = 1 WHERE id = ?`, target.id);
    await writeAudit(actor, "admin.add", "user", target.id, null, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not add the admin." };
  }
}

export async function removeAdmin(actor: User, userId: string, reason: string | null = null): Promise<ActionResult> {
  try {
    if (userId === actor.id) throw new AdminActionError("You cannot remove your own admin role.");
    const target = await get<{ id: string }>("SELECT id FROM profiles WHERE id = ?", userId);
    if (!target) throw new AdminActionError("User not found.");
    await run(`UPDATE profiles SET is_admin = 0 WHERE id = ?`, userId);
    await writeAudit(actor, "admin.remove", "user", userId, reason, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not remove the admin." };
  }
}

// ---- Moderation ----

export async function resolveSiteFlag(actor: User, flagId: string, action: "dismiss" | "unpublish" | "delete"): Promise<ActionResult> {
  try {
    const flag = await get<{ site_id: string }>("SELECT site_id FROM site_flags WHERE id = ?", flagId);
    if (!flag) throw new AdminActionError("Flag not found.");
    if (action === "unpublish") {
      const res = await unpublishSite(actor, flag.site_id);
      if (!res.ok) throw new AdminActionError(res.error!);
    } else if (action === "delete") {
      const res = await deleteSite(actor, flag.site_id);
      if (!res.ok) throw new AdminActionError(res.error!);
    }
    await run(`UPDATE site_flags SET status = 'resolved' WHERE id = ?`, flagId);
    await writeAudit(actor, `flag.${action}`, "site_flag", flagId, null, null);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not resolve the flag." };
  }
}
