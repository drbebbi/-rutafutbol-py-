import { z } from "zod";
import type { UserCaseFacts } from "../../src/domain/case/user-case-facts";
import { USER_CASE_FACTS_SCHEMA_VERSION } from "../../src/domain/case/user-case-facts";
import type { OptionalFact } from "../../src/domain/case/knowledge";

/**
 * The golden fixture wire format and its mapper into the domain.
 *
 * Deliberately independent of the persistence codec: if the domain model
 * changes shape, this mapper stops compiling and the golden suite forces a
 * conscious decision, rather than the fixtures quietly following along.
 */
const factSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.union([
    z.object({ state: z.literal("KNOWN"), value }),
    z.object({ state: z.literal("UNKNOWN") }),
    z.object({ state: z.literal("UNANSWERED") }),
    z.object({ state: z.literal("NOT_APPLICABLE") }),
  ]);

const countrySchema = z.string().regex(/^[A-Z]{2}$/u);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const booleanFact = factSchema(z.boolean());

export const fixtureFactsSchema = z.object({
  desiredProcedure: z.enum(["FIRST_CEDULA", "CEDULA_RENEWAL", "CEDULA_REPLACEMENT"]),
  adultStatus: factSchema(z.enum(["ADULT", "MINOR"])),
  location: factSchema(
    z.object({ kind: z.enum(["IN_PARAGUAY", "ABROAD"]), countryCode: countrySchema.nullable() }),
  ),
  maritalStatus: factSchema(z.enum(["SINGLE", "MARRIED", "CIVIL_UNION", "DIVORCED", "WIDOWED"])),
  holdsPreviousParaguayanCedula: booleanFact,
  nationalities: factSchema(
    z.array(
      z.object({
        countryCode: countrySchema,
        roles: z.array(z.enum(["CITIZENSHIP", "ENTRY_TRAVEL_DOCUMENT", "PROCESS_TRAVEL_DOCUMENT"])),
      }),
    ),
  ),
  residence: z.object({
    reportedType: factSchema(z.enum(["NONE", "TEMPORAL", "PERMANENT"])),
    card: z.object({
      state: factSchema(z.enum(["NOT_HELD", "IN_PROCESS", "HELD_VALID", "HELD_EXPIRED"])),
      expiryDate: factSchema(localDateSchema),
    }),
  }),
  residenceHistory: factSchema(
    z.array(
      z.object({
        countryCode: countrySchema,
        from: localDateSchema,
        to: localDateSchema.nullable(),
      }),
    ),
  ),
  entryTravelDocumentCountry: factSchema(countrySchema),
  processTravelDocumentCountry: factSchema(countrySchema),
  specialCase: z.object({
    paraguayanCitizenship: booleanFact,
    paraguayanParent: booleanFact,
    paraguayanSpouse: booleanFact,
    repatriadoFamily: booleanFact,
    diplomaticStatus: booleanFact,
    protectionStatus: booleanFact,
    investorStatus: booleanFact,
  }),
  readiness: z.object({
    documents: factSchema(
      z.array(
        z.object({
          instanceId: z.string(),
          documentTypeId: z.string(),
          issuingCountry: factSchema(countrySchema),
          issueDate: factSchema(localDateSchema),
          expiryDate: factSchema(localDateSchema),
          language: factSchema(z.string().regex(/^[a-z]{2}$/u)),
          readinessStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "OBTAINED", "EXPIRED"]),
        }),
      ),
    ),
    entryEvidence: factSchema(z.enum(["NOT_PROVIDED", "STAMP_AVAILABLE", "STAMP_MISSING"])),
  }),
});

export const goldenFixtureSchema = z.object({
  /** Permanent identity. `P2D-nnn` for Phase 2D cases, `SYN-nnn` for synthetic ones. */
  id: z.string().regex(/^(P2D|SYN)-\d{3}$/u),
  title: z.string().min(1),
  /** Synthetic fixtures assert engine mechanics, never legal content. */
  synthetic: z.boolean(),
  ruleSet: z.string().min(1),
  evaluatedAt: z.string(),
  facts: fixtureFactsSchema,
  expected: z.record(z.string(), z.unknown()),
});

export type GoldenFixture = z.infer<typeof goldenFixtureSchema>;
export type FixtureFacts = z.infer<typeof fixtureFactsSchema>;

function mapFact<T, U>(fact: { state: string; value?: T }, map: (value: T) => U): OptionalFact<U> {
  if (fact.state === "KNOWN") {
    return { state: "KNOWN", value: map(fact.value as T) };
  }
  return { state: fact.state as "UNKNOWN" | "UNANSWERED" | "NOT_APPLICABLE" };
}

function requireFact<T, U>(fact: { state: string; value?: T }, map: (value: T) => U) {
  const mapped = mapFact(fact, map);
  if (mapped.state === "NOT_APPLICABLE") {
    throw new Error("this fact cannot be NOT_APPLICABLE");
  }
  return mapped;
}

const identity = <T>(value: T): T => value;

export function toUserCaseFacts(fixture: FixtureFacts): UserCaseFacts {
  return {
    factsSchemaVersion: USER_CASE_FACTS_SCHEMA_VERSION,
    classification: {
      desiredProcedure: fixture.desiredProcedure,
      adultStatus: requireFact(fixture.adultStatus, identity),
      location: requireFact(fixture.location, (value) => ({
        kind: value.kind,
        countryCode: value.countryCode === null ? null : (value.countryCode as never),
      })),
      maritalStatus: requireFact(fixture.maritalStatus, identity),
      holdsPreviousParaguayanCedula: requireFact(fixture.holdsPreviousParaguayanCedula, identity),
      nationalities: requireFact(fixture.nationalities, (value) =>
        value.map((entry) => ({ countryCode: entry.countryCode as never, roles: entry.roles })),
      ),
      residence: {
        reportedType: requireFact(fixture.residence.reportedType, identity),
        card: {
          state: requireFact(fixture.residence.card.state, identity),
          expiryDate: mapFact(fixture.residence.card.expiryDate, (value) => value as never),
        },
      },
      residenceHistory: requireFact(fixture.residenceHistory, (value) =>
        value.map((entry) => ({
          countryCode: entry.countryCode as never,
          from: entry.from as never,
          to: entry.to === null ? null : (entry.to as never),
        })),
      ),
      entryTravelDocumentCountry: mapFact(fixture.entryTravelDocumentCountry, (v) => v as never),
      processTravelDocumentCountry: mapFact(fixture.processTravelDocumentCountry, (v) => v as never),
      specialCase: {
        paraguayanCitizenship: requireFact(fixture.specialCase.paraguayanCitizenship, identity),
        paraguayanParent: requireFact(fixture.specialCase.paraguayanParent, identity),
        paraguayanSpouse: requireFact(fixture.specialCase.paraguayanSpouse, identity),
        repatriadoFamily: requireFact(fixture.specialCase.repatriadoFamily, identity),
        diplomaticStatus: requireFact(fixture.specialCase.diplomaticStatus, identity),
        protectionStatus: requireFact(fixture.specialCase.protectionStatus, identity),
        investorStatus: requireFact(fixture.specialCase.investorStatus, identity),
      },
    },
    readiness: {
      documents: requireFact(fixture.readiness.documents, (value) =>
        value.map((entry) => ({
          instanceId: entry.instanceId as never,
          documentTypeId: entry.documentTypeId as never,
          issuingCountry: mapFact(entry.issuingCountry, (v) => v as never),
          issueDate: mapFact(entry.issueDate, (v) => v as never),
          expiryDate: mapFact(entry.expiryDate, (v) => v as never),
          language: mapFact(entry.language, (v) => v as never),
          readinessStatus: entry.readinessStatus,
        })),
      ),
      entryEvidence: requireFact(fixture.readiness.entryEvidence, identity),
    },
  };
}
