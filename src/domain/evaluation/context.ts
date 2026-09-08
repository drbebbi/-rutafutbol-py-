import type { InstantString } from "../primitives/instant";
import type { IanaTimeZone } from "../primitives/time-zone";
import type { LocalDate } from "../primitives/local-date";

/**
 * Everything time-related the engine is allowed to know.
 *
 * Deliberately absent: any notion of "what the user asked for". The desired
 * procedure lives in `UserCaseFacts.classification.desiredProcedure` and
 * nowhere else.
 */
export type EvaluationContext = Readonly<{
  evaluatedAt: InstantString;
  jurisdictionTimeZone: IanaTimeZone;
}>;

/**
 * The context the engine actually runs on.
 *
 * `effectiveLocalDate` is derived from `evaluatedAt` + `jurisdictionTimeZone`
 * exactly once, in a validated factory (`case-engine/date-math`). The engine
 * never re-derives it and never reads a clock, so the same inputs always give
 * the same legal cut-off date.
 */
export type EvaluationExecutionContext = Readonly<{
  evaluation: EvaluationContext;
  effectiveLocalDate: LocalDate;
}>;
