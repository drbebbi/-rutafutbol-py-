import pg from "pg";

/**
 * Real PostgreSQL, never a substitute engine.
 *
 * Row level security, exclusion constraints, SECURITY DEFINER and REPEATABLE
 * READ are the things being tested; none of them can be exercised against a
 * different database.
 */
export const DATABASE_URL = process.env["CEDULA_TEST_DATABASE_URL"] ?? "";

export const databaseAvailable = DATABASE_URL !== "";

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Runs a callback as a Supabase request role with a specific JWT subject, the
 * way a browser request reaches the database.
 */
export async function asRole<T>(
  client: pg.Client,
  role: "anon" | "authenticated" | "cedula_runtime_role" | "cedula_admin_runtime_role",
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      userId === null ? "" : JSON.stringify({ sub: userId, role }),
    ]);
    await client.query(`set local role ${role}`);
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function uniqueSlug(prefix: string): string {
  return `${prefix}.${Math.random().toString(36).slice(2, 10)}`;
}

export function fakeHash(seed: string): string {
  const base = seed.replace(/[^0-9a-f]/gu, "0");
  return (base + "0".repeat(64)).slice(0, 64);
}
