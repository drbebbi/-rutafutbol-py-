import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Privileged client. Service role key, no user session, no RLS.
 *
 * Import discipline is the control here: `server-only` makes a client bundle
 * import fail the build, and the architecture test forbids `src/ui` from
 * importing anything matching "privileged". Every call site must be a vetted
 * server path that has already performed its own authorization.
 */
export function createSupabasePrivilegedClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (url === undefined || serviceRoleKey === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
