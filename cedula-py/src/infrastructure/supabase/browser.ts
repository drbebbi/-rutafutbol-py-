import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client.
 *
 * Only ever sees the publishable anon key. The service role key is never
 * referenced from any module that can end up in a client bundle.
 */
export function createSupabaseBrowserClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (url === undefined || anonKey === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");
  }
  return createBrowserClient(url, anonKey);
}
