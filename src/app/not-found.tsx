import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-6" data-testid="not-found">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        That page does not exist.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to the start
      </Link>
    </main>
  );
}
