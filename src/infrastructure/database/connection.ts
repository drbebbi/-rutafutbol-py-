import "server-only";
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * A connection to the internal database.
 *
 * Not the Data API. Everything reached through here is a server-side path
 * that no browser role can take: published knowledge, evaluation bundles, the
 * authoritative evaluation writer and the admin authorization lookup.
 *
 * `prepare: false` is required, not an optimisation. Behind Supavisor's
 * transaction pooler a connection is handed to a different session between
 * statements, so a server-side prepared statement cannot be relied on to still
 * exist - and a stale one fails at exactly the wrong moment.
 */
export function openInternalConnection(connectionString: string): Sql {
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    // Notices are not application output; swallowing them keeps the allowlist
    // logger the only thing that ever writes.
    onnotice: () => undefined,
  });
}
