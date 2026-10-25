import db from "./db";

/** Simple token-bucket rate limiter backed by Postgres. Returns true if the action is allowed. */
export async function takeToken(key: string, capacity: number, refillPerSec: number): Promise<boolean> {
  const now = Math.round(Date.now() / 1000);
  const row = await db.prepare("SELECT tokens, updated_at FROM rate_limits WHERE key = ?").get<{
    tokens: number;
    updated_at: number;
  }>(key);
  let tokens = capacity;
  if (row) tokens = Math.min(capacity, row.tokens + (now - row.updated_at) * refillPerSec);
  if (tokens < 1) return false;
  await db
    .prepare(
      `INSERT INTO rate_limits (key, tokens, updated_at) VALUES (?,?,?)
       ON CONFLICT (key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`
    )
    .run(key, tokens - 1, now);
  return true;
}
