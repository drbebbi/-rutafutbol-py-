# Rule DSL

A persisted rule is **data**. It is interpreted by a closed evaluator; it is
never executed. There is no `eval`, no `new Function`, no JSONPath, no script
rule, no regular-expression DSL and no generic arithmetic language - and lint
rules plus a security test enforce that.

## Condition AST

Eight node kinds, and no ninth:

| Node | Meaning |
|---|---|
| `CONSTANT` | a fixed TRUE / FALSE / INDETERMINATE |
| `ALL` / `ANY` | three-valued conjunction / disjunction |
| `NOT` | three-valued negation |
| `FACT_STATE` | tests a fact's *knowledge state*; total, never indeterminate |
| `COMPARE` | compares a fact value to a literal operand |
| `DATE_COMPARE` | compares two date expressions calendrically |
| `INTERVAL_OVERLAP_AT_LEAST` | measures a (possibly windowed) interval |

Date expressions: `EFFECTIVE_DATE`, `LITERAL_DATE`, `FACT_DATE`, and `SHIFTED`
(base ± calendar period).

### Limits (MVP)

`depth ≤ 12`, `nodes ≤ 128`, `ALL`/`ANY` children ≤ 32. An unbounded AST loaded
from a database is an availability risk; a rule nobody can read is a correctness
risk.

## Operators

| Fact value type | Admissible operators |
|---|---|
| `STRING` | `EQ`, `NEQ`, `IN`, `NOT_IN` |
| `BOOLEAN` | `EQ`, `NEQ` |
| `INTEGER` | `EQ`, `NEQ`, `COUNT_EQ`, `COUNT_GTE`, `COUNT_LTE` |
| `STRING_SET` | `CONTAINS_ANY`, `CONTAINS_ALL` |
| `LOCAL_DATE` | *(none)* - dates use `DATE_COMPARE` |

Dates are deliberately excluded from `COMPARE`: string-comparing dates works
until it does not.

## Fact paths

Rules never read `UserCaseFacts`. They read a projection, the `RuleFactView`,
through a closed registry (`src/rules/definitions/fact-paths.ts`). An
unregistered path is `RULE_CONFIGURATION_ERROR`.

Each registered path declares:

- a **value type** (which decides operator compatibility),
- a **path scope** (`CASE`, `CONTEXT`, `NATIONALITY`, `RESIDENCE_HISTORY`,
  `DOCUMENT`),
- a **fact access domain**,
- a **blocking issue code** - the only sanctioned way for an indeterminate fact
  to become a public message.

### Fact access domains

| Domain | Contents | Readable by |
|---|---|---|
| `CASE_LEGAL` | the applicant's legal situation | every family |
| `DOCUMENT_STATE` | what papers the applicant already holds | document reuse, warnings, timelines |
| `ENTRY_READINESS` | evidence of entry available today | warnings, timelines |

This is what makes "I already have my birth certificate" incapable of deleting
the legal requirement for a birth certificate.

## Scopes

`CASE`, `EACH_NATIONALITY`, `EACH_RESIDENCE_HISTORY_ENTRY`,
`EACH_DOCUMENT_INSTANCE`. Exactly one explicit scope per rule; no nested foreach.

An **unknown collection is not an empty collection**: a rule scoped over an
unknown residence history produces one INDETERMINATE instance, not zero
instances.

## Payload families

`CLASSIFICATION`, `VISA`, `PROCEDURE`, `DOCUMENT_REQUIREMENT`,
`DOCUMENT_FORMALITY`, `DOCUMENT_REUSE`, `DEPENDENCY`, `FEE`, `WARNING`,
`SPECIAL_CASE`, `TIMELINE`.

Procedure and document rules are **not additive-only**: `REQUIRED` and
`NOT_REQUIRED` are both first-class statements that meet in the same slot.

Document reuse is its own family with its own resolved values -
`REUSABLE_CONFIRMED`, `REUSE_NOT_ALLOWED`, `REISSUE_REQUIRED` - and the **absence
of a rule yields `REUSE_UNKNOWN`**. It never yields any of the other three.

## Verification

`CONFIRMED`, `STRONG_EVIDENCE`, `CONFLICTING`, `UNKNOWN`,
`OFFICIAL_VERIFICATION_REQUIRED`. There is no `OUTDATED`: whether a revision
still applies is decided by its effective window and publication status.

A resolved rule (CONFIRMED / STRONG_EVIDENCE) must cite evidence and must **not**
carry a verification declaration. An unresolved rule must declare a
`VerificationCode` and a target kind, and carries **no substitute consequence**.
Both invariants are enforced in TypeScript, in the JSON schema, and by a database
CHECK constraint.

## Versioning

Every revision carries `payloadSchemaVersion`, currently `rule-payload@1.0`. The
version covers the *semantics* - AST meaning, operators, fact paths, date
semantics, resolver behaviour - not just the shape. No silent semantic change
under an unchanged version.
