import type { LocalDate } from "../primitives/local-date";
import type { CountryCode } from "../primitives/country";
import type { Fact, OptionalFact } from "../case/knowledge";

/**
 * What the *user reports* about their residence status. This is an input, not
 * a classification: the engine's residence classification is rule-driven and
 * may disagree with, or refuse to confirm, what was reported.
 */
export type ReportedResidenceType = "NONE" | "TEMPORAL" | "PERMANENT";

export const REPORTED_RESIDENCE_TYPES: readonly ReportedResidenceType[] = [
  "NONE",
  "TEMPORAL",
  "PERMANENT",
];

/** State of a physical residence card / certificate the applicant holds. */
export type ResidenceCardState = "NOT_HELD" | "IN_PROCESS" | "HELD_VALID" | "HELD_EXPIRED";

export const RESIDENCE_CARD_STATES: readonly ResidenceCardState[] = [
  "NOT_HELD",
  "IN_PROCESS",
  "HELD_VALID",
  "HELD_EXPIRED",
];

export type ResidenceCardFacts = Readonly<{
  state: Fact<ResidenceCardState>;
  expiryDate: OptionalFact<LocalDate>;
}>;

export type ResidenceFacts = Readonly<{
  reportedType: Fact<ReportedResidenceType>;
  card: ResidenceCardFacts;
}>;

/** An entry in the applicant's residence history. `to: null` means ongoing. */
export type ResidenceHistoryEntry = Readonly<{
  countryCode: CountryCode;
  from: LocalDate;
  to: LocalDate | null;
}>;

/**
 * The engine's own view of residence status.
 *
 * `null` means the engine has not been able to establish a classification; it
 * is never a placeholder for "probably none".
 */
export type ResidenceClassification = "NONE" | "TEMPORAL" | "PERMANENT";

export type ResidenceClassificationState =
  | "CLASSIFIED"
  | "CLASSIFICATION_REQUIRED"
  | "STATUS_REVIEW_REQUIRED"
  | "UNRESOLVED";

export type ResidenceClassificationResult = Readonly<{
  state: ResidenceClassificationState;
  classification: ResidenceClassification | null;
}>;
