import type { TruthValue } from "../../rules/definitions/ast";

/**
 * Kleene three-valued logic.
 *
 * The whole point of the third value is that "we don't know" must never be
 * silently read as "no". UNKNOWN and UNANSWERED both arrive here as
 * INDETERMINATE and stay there unless the other operands settle the question.
 */
export function andAll(values: readonly TruthValue[]): TruthValue {
  let sawIndeterminate = false;
  for (const value of values) {
    if (value === "FALSE") {
      return "FALSE";
    }
    if (value === "INDETERMINATE") {
      sawIndeterminate = true;
    }
  }
  return sawIndeterminate ? "INDETERMINATE" : "TRUE";
}

export function orAny(values: readonly TruthValue[]): TruthValue {
  let sawIndeterminate = false;
  for (const value of values) {
    if (value === "TRUE") {
      return "TRUE";
    }
    if (value === "INDETERMINATE") {
      sawIndeterminate = true;
    }
  }
  return sawIndeterminate ? "INDETERMINATE" : "FALSE";
}

export function negate(value: TruthValue): TruthValue {
  switch (value) {
    case "TRUE":
      return "FALSE";
    case "FALSE":
      return "TRUE";
    case "INDETERMINATE":
      return "INDETERMINATE";
  }
}

export function fromBoolean(value: boolean): TruthValue {
  return value ? "TRUE" : "FALSE";
}
