import Link from "next/link";

/**
 * Route owner for `/`.
 *
 * There is deliberately no `src/app/page.tsx`: two files claiming the same
 * route is a build-time ambiguity, and the public group owns the landing page.
 */
export default function LandingPage() {
  return (
    <main data-testid="landing">
      <h1 className="text-2xl font-semibold">Your first Paraguayan cedula</h1>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        Answer a few questions and Cedula PY works out which procedures and documents apply to
        your situation - and tells you plainly when something is not yet officially confirmed.
      </p>
      <Link
        href="/wizard"
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        data-testid="start-wizard"
      >
        Check my case
      </Link>
      <section className="mt-8 text-sm">
        <h2 className="font-medium">What this release covers</h2>
        <ul className="mt-2 list-disc pl-5 text-slate-600 dark:text-slate-300">
          <li>First cedula for foreigners, Europe scope.</li>
          <li>An answer that says &quot;needs official verification&quot; when that is the truth.</li>
        </ul>
      </section>
    </main>
  );
}
