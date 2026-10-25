import { Pool, PoolClient, types } from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL is not set");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Return timestamps as "YYYY-MM-DD HH:MM:SS" UTC strings so the rest of the
// app can keep the formats it used with SQLite.
types.setTypeParser(1114, (v) => (v ? v.replace("T", " ") : v));
types.setTypeParser(1184, (v) => {
  if (!v) return v;
  const d = new Date(v);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
});

// Fail fast instead of hanging forever: a stuck pooler connection otherwise
// leaves API routes waiting until the browser gives up with "Failed to fetch".
const pool = new Pool({
  connectionString: DB_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
  statement_timeout: 15_000,
  idleTimeoutMillis: 30_000,
  ssl: { rejectUnauthorized: false },
});

// Rewrite better-sqlite3 style `?` placeholders to Postgres `$1..$n`.
function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

type Queryable = Pick<PoolClient, "query">;

export type Prepared = {
  get: <T = Record<string, unknown>>(...params: unknown[]) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(...params: unknown[]) => Promise<T[]>;
  run: (...params: unknown[]) => Promise<{ changes: number }>;
};

function makeDb(q: Queryable): { prepare: (sql: string) => Prepared } {
  return {
    prepare(sql: string) {
      const text = toPg(sql);
      return {
        get: <T = Record<string, unknown>>(...params: unknown[]) =>
          q.query(text, params as unknown[]).then((r) => r.rows[0] as T | undefined),
        all: <T = Record<string, unknown>>(...params: unknown[]) =>
          q.query(text, params as unknown[]).then((r) => r.rows as T[]),
        run: (...params: unknown[]) =>
          q.query(text, params as unknown[]).then((res) => ({ changes: res.rowCount ?? 0 })),
      };
    },
  };
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  const res = await pool.query(toPg(sql), params);
  return res as unknown as { rows: T[] };
}

export async function get<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const { rows } = await query<T>(sql, params as unknown[]);
  return rows[0];
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { rows } = await query<T>(sql, params as unknown[]);
  return rows;
}

export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const res = await pool.query(toPg(sql), params as unknown[]);
  return { changes: res.rowCount ?? 0 };
}

/** Run several statements atomically. */
export async function tx<T>(fn: (db: { prepare: (sql: string) => Prepared }) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(makeDb(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const db = makeDb(pool);
export default db;
