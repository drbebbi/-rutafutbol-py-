import { WizardForm } from "../../../ui/wizard/wizard-form";

/**
 * Anonymous evaluation.
 *
 * Nothing is persisted for an anonymous visitor: no case row, no tracking
 * identity, and the answers never leave the request.
 */
export const dynamic = "force-dynamic";

function endpoint(): string {
  // The synthetic fixture route exists only so the system wiring can be tested
  // end to end before an approved knowledge base exists. It is refused outside
  // a local or preview environment.
  return process.env["CEDULA_SYNTHETIC_KNOWLEDGE"] === "1"
    ? "/api/test-fixtures/evaluate"
    : "/api/evaluate";
}

export default function WizardPage() {
  return (
    <main data-testid="wizard">
      <h1 className="text-xl font-semibold">Check my case</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Your answers are evaluated and shown back to you. Nothing is stored unless you create an
        account and save the case yourself.
      </p>
      <div className="mt-6">
        <WizardForm endpoint={endpoint()} />
      </div>
    </main>
  );
}
