"use client";

import { useState } from "react";

/**
 * The wizard integration seam.
 *
 * Not the finished wizard UX - just enough of one to prove the wiring:
 * answers in, an evaluation request out, a decision summary rendered back.
 * Every legal decision in the response was made by the engine; nothing here
 * interprets anything.
 */
type DecisionSummary = Readonly<{
  status: string;
  caseType: string | null;
  requiredProcedureCount: number;
  requiredDocumentCount: number;
  blockingIssues: readonly string[];
  verificationFlags: readonly string[];
}>;

type ResponseBody =
  | Readonly<{ ok: true; summary: DecisionSummary }>
  | Readonly<{ ok: false; code: string; message: string; correlationId: string }>;

export function WizardForm({ endpoint }: Readonly<{ endpoint: string }>) {
  const [citizenship, setCitizenship] = useState("DE");
  const [residence, setResidence] = useState("NONE");
  const [knowsResidence, setKnowsResidence] = useState(true);
  const [holdsPreviousCedula, setHoldsPreviousCedula] = useState(false);
  const [paraguayanSpouse, setParaguayanSpouse] = useState(false);
  const [result, setResult] = useState<ResponseBody | null>(null);
  const [pending, setPending] = useState(false);

  async function runSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Same-origin only: the endpoint rejects a cross-origin request, and
        // credentials are never sent anywhere else.
        credentials: "same-origin",
        body: JSON.stringify({
          citizenship,
          residence: knowsResidence ? residence : null,
          holdsPreviousCedula,
          paraguayanSpouse,
        }),
      });
      setResult((await response.json()) as ResponseBody);
    } catch {
      setResult({
        ok: false,
        code: "NETWORK",
        message: "The request could not be completed. Please try again.",
        correlationId: "client",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={(event) => { void runSubmit(event); }} className="space-y-4" data-testid="wizard-form">
        <label className="block text-sm">
          <span className="font-medium">Which passport will you use?</span>
          <select
            className="mt-1 block w-full rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-900"
            value={citizenship}
            onChange={(event) => setCitizenship(event.target.value)}
            data-testid="citizenship"
          >
            {["DE", "CH", "AT", "ES", "FR", "IT", "PT", "NL", "BE", "GB", "BR"].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="text-sm">
          <legend className="font-medium">Do you already have a Paraguayan residence?</legend>
          <label className="mt-1 block">
            <input
              type="checkbox"
              checked={!knowsResidence}
              onChange={(event) => setKnowsResidence(!event.target.checked)}
              data-testid="residence-unknown"
            />{" "}
            I do not know
          </label>
          <select
            className="mt-1 block w-full rounded border border-slate-300 p-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
            value={residence}
            disabled={!knowsResidence}
            onChange={(event) => setResidence(event.target.value)}
            data-testid="residence"
          >
            <option value="NONE">No residence yet</option>
            <option value="TEMPORAL">Temporal</option>
            <option value="PERMANENT">Permanent</option>
          </select>
        </fieldset>

        <label className="block text-sm">
          <input
            type="checkbox"
            checked={holdsPreviousCedula}
            onChange={(event) => setHoldsPreviousCedula(event.target.checked)}
            data-testid="previous-cedula"
          />{" "}
          I have held a Paraguayan cedula before
        </label>

        <label className="block text-sm">
          <input
            type="checkbox"
            checked={paraguayanSpouse}
            onChange={(event) => setParaguayanSpouse(event.target.checked)}
            data-testid="paraguayan-spouse"
          />{" "}
          My spouse is Paraguayan
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          data-testid="submit"
        >
          {pending ? "Checking..." : "Check my case"}
        </button>
      </form>

      {result !== null && result.ok ? (
        <section className="mt-6 rounded border border-slate-200 p-4 text-sm dark:border-slate-800" data-testid="result">
          <p>
            Status: <strong data-testid="status">{result.summary.status}</strong>
          </p>
          <p>
            Case type: <span data-testid="case-type">{result.summary.caseType ?? "not yet determinable"}</span>
          </p>
          <p data-testid="procedure-count">Procedures: {result.summary.requiredProcedureCount}</p>
          <p data-testid="document-count">Documents: {result.summary.requiredDocumentCount}</p>
          {result.summary.blockingIssues.length > 0 ? (
            <ul className="mt-2 list-disc pl-5" data-testid="blocking-issues">
              {result.summary.blockingIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {result.summary.verificationFlags.length > 0 ? (
            <ul className="mt-2 list-disc pl-5" data-testid="verification-flags">
              {result.summary.verificationFlags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {result !== null && !result.ok ? (
        <p className="mt-6 text-sm text-red-700 dark:text-red-400" data-testid="error">
          {result.message} (reference {result.correlationId})
        </p>
      ) : null}
    </div>
  );
}
