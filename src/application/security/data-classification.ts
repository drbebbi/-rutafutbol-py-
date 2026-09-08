/**
 * Technical data classification.
 *
 * Deliberately a code registry rather than a per-table enum: the classification
 * of `app.case_evaluations.input_snapshot_jsonb` is a property of the *field*,
 * and putting it in a column would make the classification itself mutable data.
 * This registry is testable, reviewable and referenced by the logging allowlist.
 */
export type DataClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "PERSONAL"
  | "PERSONAL_HIGH_RISK"
  | "SECRET";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "PERSONAL",
  "PERSONAL_HIGH_RISK",
  "SECRET",
];

export type ClassifiedAsset = Readonly<{
  asset: string;
  classification: DataClassification;
  note: string;
}>;

export const DATA_CLASSIFICATION_REGISTRY: readonly ClassifiedAsset[] = [
  { asset: "core.*", classification: "PUBLIC", note: "Published knowledge; readable anonymously." },
  { asset: "audit.evaluation_bundles", classification: "INTERNAL", note: "Shared, non-personal knowledge snapshots." },
  { asset: "audit.admin_audit_events", classification: "INTERNAL", note: "Administrative acts on the knowledge base." },
  { asset: "app.user_cases.owner_user_id", classification: "PERSONAL", note: "Subject identifier." },
  {
    asset: "app.user_cases.facts_jsonb",
    classification: "PERSONAL_HIGH_RISK",
    note: "Residence history, special-case answers, protection status, combined migration context.",
  },
  {
    asset: "app.case_evaluations.input_snapshot_jsonb",
    classification: "PERSONAL_HIGH_RISK",
    note: "Complete evaluation input; the same content as facts_jsonb, frozen.",
  },
  { asset: "app.case_evaluations.decision_jsonb", classification: "PERSONAL", note: "Derived from personal input." },
  { asset: "security.admin_authorizations", classification: "INTERNAL", note: "Authorization state." },
  { asset: "security.erasure_journal", classification: "PERSONAL", note: "Subject id and outcome only." },
  { asset: "SUPABASE_SERVICE_ROLE_KEY", classification: "SECRET", note: "Never in a client bundle or a log." },
  { asset: "SUPABASE_DB_URL", classification: "SECRET", note: "Never in a client bundle or a log." },
];

/**
 * PERSONAL_HIGH_RISK assets are excluded from standard logs and from analytics
 * entirely, and are reachable only through an owner-scoped path.
 */
export function isHighRisk(asset: string): boolean {
  return DATA_CLASSIFICATION_REGISTRY.some(
    (entry) => entry.asset === asset && entry.classification === "PERSONAL_HIGH_RISK",
  );
}
