import { z } from "zod";
import { err, ok, type Result } from "../../shared/result/result";
import { knownFact, unknownFact } from "../../domain/case/knowledge";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import { USER_CASE_FACTS_SCHEMA_VERSION } from "../../domain/case/user-case-facts";
import type { CountryCode } from "../../domain/primitives/country";
import type { CaseEvaluationDecision } from "../../domain/evaluation/decision";

/**
 * The minimal wizard contract for this foundation release.
 *
 * A deliberately small slice of the fact model: enough to prove the wiring end
 * to end without pretending the finished wizard exists. Everything not asked is
 * UNANSWERED, which the engine turns into a blocking issue rather than a guess.
 */
export const wizardAnswersSchema = z.object({
  citizenship: z.string().regex(/^[A-Z]{2}$/u),
  residence: z.enum(["NONE", "TEMPORAL", "PERMANENT"]).nullable(),
  holdsPreviousCedula: z.boolean().default(false),
  paraguayanSpouse: z.boolean().default(false),
});

export type WizardAnswers = z.infer<typeof wizardAnswersSchema>;

export function parseWizardAnswers(input: unknown): Result<WizardAnswers, string> {
  const parsed = wizardAnswersSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("malformed request");
}

export function wizardAnswersToFacts(answers: WizardAnswers): UserCaseFacts {
  const country = answers.citizenship as CountryCode;
  return {
    factsSchemaVersion: USER_CASE_FACTS_SCHEMA_VERSION,
    classification: {
      desiredProcedure: "FIRST_CEDULA",
      adultStatus: knownFact("ADULT"),
      location: knownFact({ kind: "IN_PARAGUAY", countryCode: "PY" as CountryCode }),
      maritalStatus: knownFact("SINGLE"),
      holdsPreviousParaguayanCedula: knownFact(answers.holdsPreviousCedula),
      nationalities: knownFact([
        { countryCode: country, roles: ["CITIZENSHIP", "ENTRY_TRAVEL_DOCUMENT", "PROCESS_TRAVEL_DOCUMENT"] },
      ]),
      residence: {
        // "I do not know" stays UNKNOWN all the way into the engine.
        reportedType: answers.residence === null ? unknownFact : knownFact(answers.residence),
        card: { state: knownFact("NOT_HELD"), expiryDate: { state: "NOT_APPLICABLE" } },
      },
      residenceHistory: knownFact([]),
      entryTravelDocumentCountry: knownFact(country),
      processTravelDocumentCountry: knownFact(country),
      specialCase: {
        paraguayanCitizenship: knownFact(false),
        paraguayanParent: knownFact(false),
        paraguayanSpouse: knownFact(answers.paraguayanSpouse),
        repatriadoFamily: knownFact(false),
        diplomaticStatus: knownFact(false),
        protectionStatus: knownFact(false),
        investorStatus: knownFact(false),
      },
    },
    readiness: {
      documents: knownFact([]),
      entryEvidence: knownFact("NOT_PROVIDED"),
    },
  };
}

/**
 * What the browser is allowed to see of a decision.
 *
 * Counts and codes, never the facts that produced them, and never provenance
 * internals. The full decision stays server-side.
 */
export type DecisionSummary = Readonly<{
  status: string;
  caseType: string | null;
  requiredProcedureCount: number;
  requiredDocumentCount: number;
  blockingIssues: readonly string[];
  verificationFlags: readonly string[];
}>;

export function summariseDecision(decision: CaseEvaluationDecision): DecisionSummary {
  return {
    status: decision.caseClassification.status,
    caseType: decision.caseClassification.caseType,
    requiredProcedureCount: decision.requiredProcedures.length,
    requiredDocumentCount: decision.requiredDocuments.length,
    blockingIssues: decision.blockingIssues.map((issue) => issue.code),
    verificationFlags: decision.verificationFlags.map((flag) => flag.code),
  };
}
