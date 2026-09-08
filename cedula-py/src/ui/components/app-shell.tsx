import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The public shell. No business logic lives in the UI layer: components render
 * what the application layer decided and nothing more.
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <nav className="mx-auto flex max-w-3xl items-center justify-between p-4">
          <Link href="/" className="text-base font-semibold" data-testid="brand">
            Cedula PY
          </Link>
          <ul className="flex gap-4 text-sm">
            <li>
              <Link href="/wizard" data-testid="nav-wizard">
                Check my case
              </Link>
            </li>
            <li>
              <Link href="/case" data-testid="nav-case">
                My case
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</div>
      <footer className="border-t border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
        Cedula PY explains official processes. It is not legal advice, and it says so whenever
        something still needs official verification.
      </footer>
    </div>
  );
}
