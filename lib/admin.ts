import crypto from "crypto";
import db, { all, get, query, run } from "./db";
import { FAILURE_LABELS, failureReasonFromLog, type FailureReason } from "./failures";
import type { User } from "./auth";
import buildInfo from "./build-info.json";

export type Range = "24h" | "7d" | "30d" | "all";

const RANGE_SQL: Record<Range, string> = {
  "24h": `interval '24 hours'`,
  "7d": `interval '7 days'`,
  "30d": `interval '30 days'`,
  all: `interval '100 years'`,
};

function rangeWhere(col: string, range: Range): string {
  return `${col} >= now() - ${RANGE_SQL[range]}`;
}

export type AdminStats = {
  users: number;
  usersPrev: number;
  sites: number;
  sitesPrev: number;
  builds: number;
  buildsPrev: number;
  published: number;
  publishedRate: number;
  failed: number;
  successRate: number;
  avgBuildSeconds: number;
  activeBuilds: number;
  queuedBuilds: number;
};

export async function getAdminStats(range: Range): Promise<AdminStats> {
  const one = async (sql: string): Promise<number> => {
    const row = await get<{ n: string | number }>(sql);
    return Number(row?.n ?? 0);
  };
  const inRange = rangeWhere("created_at", range);
  const prevStart =
    range === "all" ? `interval '100 years'` : `${RANGE_SQL[range]} + ${RANGE_SQL[range]}`;
  const prevWhere = `created_at >= now() - (${prevStart}) AND created_at < now() - ${RANGE_SQL[range]}`;

  const [users, usersPrev, sites, sitesPrev, builds, buildsPrev, published, failed, finished, successful, activeBuilds, queuedBuilds] =
    await Promise.all([
      one(`SELECT COUNT(*) AS n FROM profiles WHERE ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM profiles WHERE ${prevWhere}`),
      one(`SELECT COUNT(*) AS n FROM sites WHERE ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM sites WHERE ${prevWhere}`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE ${prevWhere}`),
      one(`SELECT COUNT(*) AS n FROM sites WHERE status = 'published'`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'failed' AND ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE status IN ('ready','failed') AND ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'ready' AND ${inRange}`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'building'`),
      one(`SELECT COUNT(*) AS n FROM builds WHERE status IN ('pending','queued')`),
    ]);

  const avg = await get<{ avg: string | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg
     FROM builds
     WHERE status IN ('ready','failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL AND ${inRange}`
  );

  return {
    users,
    usersPrev,
    sites,
    sitesPrev,
    builds,
    buildsPrev,
    published,
    publishedRate: sites ? Math.round((published / sites) * 100) : 0,
    failed,
    successRate: finished ? Math.round((successful / finished) * 100) : 0,
    avgBuildSeconds: Math.round(Number(avg?.avg ?? 0)),
    activeBuilds,
    queuedBuilds,
  };
}

export type FailureGroup = { reason: FailureReason; label: string; count: number };

export async function getFailureGroups(range: Range): Promise<FailureGroup[]> {
  const rows = await all<{ failure_reason: string | null; log: string }>(
    `SELECT failure_reason, log FROM builds WHERE status = 'failed' AND ${rangeWhere("created_at", range)}`
  );
  const counts = new Map<FailureReason, number>();
  for (const r of rows) {
    const reason = (r.failure_reason as FailureReason | null) ?? failureReasonFromLog(r.log ?? "");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: FAILURE_LABELS[reason], count }))
    .sort((a, b) => b.count - a.count);
}

export type AdminUserRow = {
  id: string;
  email: string;
  created_at: string;
  is_admin: number;
  status: string;
  sites: number;
  published: number;
  builds: number;
  last_build_at: string | null;
  builds_used: number;
  builds_allowed: number;
};

const USER_COLUMNS = `
  p.id, p.email, p.created_at, p.is_admin, p.status,
  (SELECT COUNT(*) FROM sites s WHERE s.user_id = p.id) AS sites,
  (SELECT COUNT(*) FROM sites s WHERE s.user_id = p.id AND s.status = 'published') AS published,
  (SELECT COUNT(*) FROM builds b JOIN sites s ON s.id = b.site_id WHERE s.user_id = p.id) AS builds,
  (SELECT MAX(b.created_at) FROM builds b JOIN sites s ON s.id = b.site_id WHERE s.user_id = p.id) AS last_build_at,
  COALESCE(q.builds_used, 0) AS builds_used,
  COALESCE(q.builds_allowed, 0) AS builds_allowed
`;

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  return all<AdminUserRow>(
    `SELECT ${USER_COLUMNS} FROM profiles p LEFT JOIN quota q ON q.user_id = p.id ORDER BY p.created_at DESC`
  );
}

export async function getAdminUser(id: string): Promise<AdminUserRow | null> {
  return (
    (await get<AdminUserRow>(
      `SELECT ${USER_COLUMNS} FROM profiles p LEFT JOIN quota q ON q.user_id = p.id WHERE p.id = ?`,
      id
    )) ?? null
  );
}

export type AdminSiteRow = {
  id: string;
  business_name: string;
  slug: string;
  category: string;
  status: string;
  custom_domain: string | null;
  created_at: string;
  owner_id: string;
  owner_email: string;
  last_build_status: string | null;
  last_build_at: string | null;
};

const SITE_COLUMNS = `
  s.id, s.business_name, s.slug, s.category, s.status, s.custom_domain, s.created_at,
  p.id AS owner_id, p.email AS owner_email,
  (SELECT b.status FROM builds b WHERE b.site_id = s.id ORDER BY b.created_at DESC LIMIT 1) AS last_build_status,
  (SELECT b.created_at FROM builds b WHERE b.site_id = s.id ORDER BY b.created_at DESC LIMIT 1) AS last_build_at
`;

export async function listAdminSites(): Promise<AdminSiteRow[]> {
  return all<AdminSiteRow>(
    `SELECT ${SITE_COLUMNS} FROM sites s JOIN profiles p ON p.id = s.user_id ORDER BY s.created_at DESC`
  );
}

export async function getAdminSite(id: string): Promise<AdminSiteRow | null> {
  return (
    (await get<AdminSiteRow>(
      `SELECT ${SITE_COLUMNS} FROM sites s JOIN profiles p ON p.id = s.user_id WHERE s.id = ?`,
      id
    )) ?? null
  );
}

export type AdminBuildRow = {
  id: string;
  status: string;
  kind: string;
  input: string;
  failure_reason: string | null;
  reviewed: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log: string;
  site_id: string;
  business_name: string;
  slug: string;
  owner_id: string;
  owner_email: string;
};

const BUILD_COLUMNS = `
  b.id, b.status, b.kind, b.input, b.failure_reason, b.reviewed,
  b.created_at, b.started_at, b.finished_at, b.log,
  s.id AS site_id, s.business_name, s.slug, p.id AS owner_id, p.email AS owner_email
`;

export async function listRecentBuilds(limit = 200): Promise<AdminBuildRow[]> {
  const rows = await all<AdminBuildRow>(
    `SELECT ${BUILD_COLUMNS}
     FROM builds b JOIN sites s ON s.id = b.site_id JOIN profiles p ON p.id = s.user_id
     ORDER BY b.created_at DESC LIMIT ?`,
    limit
  );
  return rows.map((r) => ({
    ...r,
    failure_reason: r.status === "failed" ? (r.failure_reason ?? failureReasonFromLog(r.log ?? "")) : null,
  }));
}

export async function getAdminBuild(id: string): Promise<AdminBuildRow | null> {
  const row = await get<AdminBuildRow>(
    `SELECT ${BUILD_COLUMNS}
     FROM builds b JOIN sites s ON s.id = b.site_id JOIN profiles p ON p.id = s.user_id
     WHERE b.id = ?`,
    id
  );
  if (!row) return null;
  return {
    ...row,
    failure_reason: row.status === "failed" ? (row.failure_reason ?? failureReasonFromLog(row.log ?? "")) : null,
  };
}

export async function listSitesForUser(userId: string): Promise<AdminSiteRow[]> {
  return all<AdminSiteRow>(
    `SELECT ${SITE_COLUMNS} FROM sites s JOIN profiles p ON p.id = s.user_id WHERE s.user_id = ? ORDER BY s.created_at DESC`,
    userId
  );
}

export async function listSiteBuilds(siteId: string, limit = 100): Promise<AdminBuildRow[]> {
  const rows = await all<AdminBuildRow>(
    `SELECT ${BUILD_COLUMNS}
     FROM builds b JOIN sites s ON s.id = b.site_id JOIN profiles p ON p.id = s.user_id
     WHERE b.site_id = ? ORDER BY b.created_at DESC LIMIT ?`,
    siteId,
    limit
  );
  return rows.map((r) => ({
    ...r,
    failure_reason: r.status === "failed" ? (r.failure_reason ?? failureReasonFromLog(r.log ?? "")) : null,
  }));
}

export async function listBuildsForUser(userId: string, limit = 100): Promise<AdminBuildRow[]> {
  const rows = await all<AdminBuildRow>(
    `SELECT ${BUILD_COLUMNS}
     FROM builds b JOIN sites s ON s.id = b.site_id JOIN profiles p ON p.id = s.user_id
     WHERE s.user_id = ? ORDER BY b.created_at DESC LIMIT ?`,
    userId,
    limit
  );
  return rows.map((r) => ({
    ...r,
    failure_reason: r.status === "failed" ? (r.failure_reason ?? failureReasonFromLog(r.log ?? "")) : null,
  }));
}

export type ActivityEvent = { at: string; kind: string; text: string; href: string | null };

export async function listUserActivity(userId: string, limit = 50): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];
  const sites = await all<{ id: string; business_name: string; created_at: string }>(
    `SELECT id, business_name, created_at FROM sites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit
  );
  for (const s of sites) events.push({ at: s.created_at, kind: "site", text: `Created "${s.business_name}"`, href: `/admin/websites/${s.id}` });
  const builds = await all<{ id: string; status: string; created_at: string; business_name: string }>(
    `SELECT b.id, b.status, b.created_at, s.business_name
     FROM builds b JOIN sites s ON s.id = b.site_id WHERE s.user_id = ? ORDER BY b.created_at DESC LIMIT ?`,
    userId,
    limit
  );
  for (const b of builds) {
    events.push({
      at: b.created_at,
      kind: b.status,
      text: `Build ${b.status} for "${b.business_name}"`,
      href: `/admin/builds/${b.id}`,
    });
  }
  const audits = await all<{ created_at: string; action: string; target_type: string | null }>(
    `SELECT created_at, action, target_type FROM audit_log WHERE target_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit
  );
  for (const a of audits) events.push({ at: a.created_at, kind: "admin", text: a.action, href: null });
  return events.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

// ---- Audit log ----

export type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  ip: string | null;
  created_at: string;
};

export async function writeAudit(
  actor: User,
  action: string,
  targetType: string | null,
  targetId: string | null,
  reason: string | null,
  ip: string | null
): Promise<void> {
  await run(
    `INSERT INTO audit_log (id, actor_id, actor_email, action, target_type, target_id, reason, ip) VALUES (?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), actor.id, actor.email, action, targetType, targetId, reason ?? null, ip ?? null
  );
}

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  return all<AuditRow>(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`, limit);
}

// ---- Platform settings ----

export type PlatformSettings = {
  default_builds_allowed: number;
  announcement_banner: string;
  banned_words: string[];
  feature_beta_builds: boolean;
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const rows = await all<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    default_builds_allowed: Number(map.get("default_builds_allowed") ?? 5),
    announcement_banner: String(map.get("announcement_banner") ?? ""),
    banned_words: Array.isArray(map.get("banned_words")) ? (map.get("banned_words") as string[]) : [],
    feature_beta_builds: map.get("feature_beta_builds") !== false,
  };
}

export async function setPlatformSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  await run(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?,?,?,now())
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    key, JSON.stringify(value), updatedBy
  );
}

// ---- Moderation ----

export type SiteFlagRow = {
  id: string;
  site_id: string;
  business_name: string;
  slug: string;
  reason: string;
  status: string;
  created_at: string;
};

export async function listSiteFlags(): Promise<SiteFlagRow[]> {
  return all<SiteFlagRow>(
    `SELECT f.id, f.site_id, s.business_name, s.slug, f.reason, f.status, f.created_at
     FROM site_flags f JOIN sites s ON s.id = f.site_id ORDER BY f.created_at DESC LIMIT 200`
  );
}

// ---- System health ----

export async function getSystemHealth(): Promise<{
  version: string;
  builtAt: string;
  queued: number;
  building: number;
  ready7d: number;
  failed7d: number;
  avgBuildSeconds7d: number;
}> {
  const one = async (sql: string): Promise<number> => {
    const row = await get<{ n: string | number }>(sql);
    return Number(row?.n ?? 0);
  };
  const [queued, building, ready7d, failed7d] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM builds WHERE status IN ('pending','queued')`),
    one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'building'`),
    one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'ready' AND created_at >= now() - interval '7 days'`),
    one(`SELECT COUNT(*) AS n FROM builds WHERE status = 'failed' AND created_at >= now() - interval '7 days'`),
  ]);
  const avg = await get<{ avg: string | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg FROM builds
     WHERE status IN ('ready','failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL
       AND created_at >= now() - interval '7 days'`
  );
  return {
    version: process.env.APP_VERSION ?? buildInfo.version,
    builtAt: buildInfo.builtAt,
    queued,
    building,
    ready7d,
    failed7d,
    avgBuildSeconds7d: Math.round(Number(avg?.avg ?? 0)),
  };
}

export async function getBuildStatsOverTime(range: Range): Promise<{ day: string; builds: number; ready: number; failed: number }[]> {
  const { rows } = await query<{ day: string; builds: string; ready: string; failed: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(*) AS builds,
            COUNT(*) FILTER (WHERE status = 'ready') AS ready,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM builds
     WHERE ${rangeWhere("created_at", range)}
     GROUP BY 1 ORDER BY 1`
  );
  return rows.map((r) => ({ day: r.day, builds: Number(r.builds), ready: Number(r.ready), failed: Number(r.failed) }));
}

export async function getSignupsOverTime(range: Range): Promise<{ day: string; count: number }[]> {
  const { rows } = await query<{ day: string; count: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS count
     FROM profiles
     WHERE ${rangeWhere("created_at", range)}
     GROUP BY 1 ORDER BY 1`
  );
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

export async function getCategoryBreakdown(): Promise<{ category: string; sites: number }[]> {
  const { rows } = await query<{ category: string; sites: string }>(
    `SELECT category, COUNT(*) AS sites FROM sites GROUP BY category ORDER BY sites DESC`
  );
  return rows.map((r) => ({ category: r.category, sites: Number(r.sites) }));
}

export async function getStageDurations7d(): Promise<{ kind: string; count: number; avgMinutes: number }[]> {
  const { rows } = await query<{ kind: string; count: string; avg: string | null }>(
    `SELECT kind, COUNT(*) AS count, AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) / 60 AS avg
     FROM builds
     WHERE status = 'ready' AND started_at IS NOT NULL AND finished_at IS NOT NULL
       AND created_at >= now() - interval '7 days'
     GROUP BY kind`
  );
  return rows.map((r) => ({ kind: r.kind, count: Number(r.count), avgMinutes: Math.round(Number(r.avg ?? 0) * 10) / 10 }));
}
