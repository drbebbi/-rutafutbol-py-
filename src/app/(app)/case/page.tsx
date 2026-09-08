import Link from "next/link";
import { createSupabaseServerClient } from "../../../infrastructure/supabase/server";
import { resolveAuthenticatedIdentity } from "../../../infrastructure/supabase/auth/identity";

/**
 * The authenticated seam.
 *
 * Force-dynamic and never cached: a page that can render one user's case must
 * never be served to another visitor from a shared cache.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function CasePage() {
  let identity = null;
  try {
    const client = await createSupabaseServerClient();
    identity = await resolveAuthenticatedIdentity(client);
  } catch {
    // Supabase is not configured in this environment; the page still has to
    // render its signed-out state rather than crash.
    identity = null;
  }

  if (identity === null) {
    return (
      <main data-testid="case-signed-out">
        <h1 className="text-xl font-semibold">My case</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Sign in to save a case and come back to it later.
        </p>
        <Link href="/wizard" className="mt-4 inline-block text-sm underline">
          Check your case without an account
        </Link>
      </main>
    );
  }

  return (
    <main data-testid="case-signed-in">
      <h1 className="text-xl font-semibold">My case</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Signed in. Saved cases and their evaluations appear here.
      </p>
    </main>
  );
}
