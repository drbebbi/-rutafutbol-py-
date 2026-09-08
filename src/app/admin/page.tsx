import { createSupabaseServerClient } from "../../infrastructure/supabase/server";
import {
  checkSessionLiveness,
  resolveAuthenticatedIdentity,
} from "../../infrastructure/supabase/auth/identity";
import { authorizePrivilegedAction } from "../../auth/authorization/authorization";

/**
 * The administrative boundary.
 *
 * Authority comes from `security.admin_authorizations` via verified claims,
 * never from user metadata. Reaching this page proves nothing on its own: each
 * privileged action re-checks role, AAL2 and session liveness at the moment it
 * runs.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type AdminAccess = Readonly<{ granted: boolean; reason: string }>;

async function resolveAdminAccess(): Promise<AdminAccess> {
  try {
    const client = await createSupabaseServerClient();
    const identity = await resolveAuthenticatedIdentity(client);
    const liveness = identity === null ? null : await checkSessionLiveness(client);
    const authorized = authorizePrivilegedAction(identity, "READ_ADMIN_AUDIT", liveness, Date.now());
    return authorized.ok
      ? { granted: true, reason: "OK" }
      : { granted: false, reason: authorized.error.reason };
  } catch {
    // Supabase is not configured here, which is indistinguishable from being
    // unauthenticated as far as this boundary is concerned.
    return { granted: false, reason: "NOT_AUTHENTICATED" };
  }
}

export default async function AdminPage() {
  const access = await resolveAdminAccess();

  if (access.granted) {
    return (
      <main data-testid="admin-granted">
        <h1 className="text-xl font-semibold">Knowledge administration</h1>
        <p className="mt-2 text-sm">
          Publication runs through the validation service and is bound to the exact validated
          candidate hash.
        </p>
      </main>
    );
  }

  return (
    <main data-testid="admin-denied">
      <h1 className="text-xl font-semibold">Not available</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" data-testid="admin-denied-reason">
        {access.reason}
      </p>
    </main>
  );
}
