# Engine contract

```ts
function evaluateCase(
  facts: UserCaseFacts,
  context: EvaluationExecutionContext,
  bundle: EngineReadyBundleContent,
  engine: EngineDescriptor,
): Result<CaseEvaluationDecision, EngineError>;
```

Four inputs, one output, no side effects. The engine does not read a database,
call HTTP, read `Date.now()`, read the environment, read an auth session, log,
persist, or generate a random identifier.

## Time

`EvaluationContext` is exactly:

```ts
{ evaluatedAt: InstantString; jurisdictionTimeZone: IanaTimeZone }
```

It carries **no** `requestedProcedure`. The only authoritative statement of what
the user wants is `UserCaseFacts.classification.desiredProcedure`, so the two can
never disagree.

`createEvaluationExecutionContext` derives `effectiveLocalDate` from those two
values **once**. The jurisdiction default is `America/Asuncion`; no legal
decision may depend on the server's time zone. The bundle is loaded for that same
date, and the engine refuses a bundle assembled for a different one
(`BUNDLE_EFFECTIVE_DATE_MISMATCH`).

## Knowledge states and three-valued logic

`KNOWN | UNKNOWN | UNANSWERED | NOT_APPLICABLE`.

UNKNOWN and UNANSWERED both evaluate to `INDETERMINATE`. Neither ever becomes
`FALSE`: "we don't know whether you are married" is not "you are not married".

| | ALL | ANY |
|---|---|---|
| any FALSE | FALSE | - |
| all TRUE | TRUE | - |
| any TRUE | - | TRUE |
| all FALSE | - | FALSE |
| otherwise | INDETERMINATE | INDETERMINATE |

`NOT` maps TRUE↔FALSE and leaves INDETERMINATE alone.

`NOT_APPLICABLE` compared as a value is INDETERMINATE. If a rule then *stays*
indeterminate because of an unguarded NOT_APPLICABLE and that would change a
decision, the engine raises `RULE_CONFIGURATION_ERROR / UNGUARDED_NOT_APPLICABLE`
rather than `NEEDS_USER_INFORMATION`: that is a modelling defect, not a question
for the user. `FACT_STATE` is the guard, and it is total by construction.

## Decision slots, merging, precedence

Statements meet only inside a slot: `CASE_TYPE`, `RESIDENCE_CLASSIFICATION`,
`VISA`, `PROCEDURE_REQUIREMENT`, `DOCUMENT_REQUIREMENT`, `FORMALITY`,
`DEPENDENCY`, `DOCUMENT_REUSE`, `FEE`, `WARNING`.

- Same slot, **same** canonical consequence → merge. Support is CONFIRMED if any
  contributing rule is confirmed; all provenance is kept.
- Same slot, **incompatible** consequence → a winner needs explicit precedence,
  or the result is `DECISION_CONFLICT`. Never first-match-wins.

A suppressing winner must be TRUE **and** RESOLVED **and** CONFIRMED, and must
dominate **every** opposing candidate **directly**. Precedence is not transitive:

```
A overrides B,  B overrides C,  nothing says A overrides C
three different consequences            → DECISION_CONFLICT
```

Only `EXCEPTION_TO` and `OVERRIDES` exist. There is no numeric priority, no
automatic specificity, no automatic source recency. A precedence cycle is a
configuration error, and precedence across incompatible slot families is
rejected at publication.

Anything a confirmed winner explicitly dominates is silenced for *all* purposes:
it can neither raise a verification request nor block on a fact, because it could
not have changed the answer.

## Decision-relevant indeterminacy

An indeterminate rule blocks only when its possible TRUE outcome could change the
slot's current answer. The fact paths that made it indeterminate are then
translated - through the **closed** fact-dependency policy registry - into
business `BlockingIssueCode`s. There is no generic `MISSING_FIELD(path)` output,
and a path with no mapping is an engine invariant violation.

## Derived keys

```
rp1:<procedureId>|<name>=<t>:<value>;…|<discriminator|->
rd1:<requiredProcedureKey>|<documentTypeId>|<issuingCountry|->|<discriminator|->
```

Sorted by parameter name, percent-encoded, purely content-derived. Never a UUID,
never an array index, never a rule revision id. `EngineDescriptor` carries
`derivedKeyFormatVersion`; the engine refuses a version it does not implement.

## Target resolution

`MATCHED` → apply. `NEGATIVELY_RESOLVED` → the downstream effect does not apply.
`MISSING` or `AMBIGUOUS` → `RULE_CONFIGURATION_ERROR`, but only when the pointing
rule is TRUE; an indeterminate rule is merely skipped and its facts carried
forward.

## Fees

`FIXED` | `INDEXED {multiplier, feeIndexId}` | `EXTERNAL_VARIABLE {costCode}`.

A fee index must resolve to exactly one revision for the effective date: zero is
`FEE_INDEX_MISSING`, more than one is `FEE_INDEX_AMBIGUOUS`. An unresolved index
yields `calculatedAmount: null` plus a verification flag - never an approximate
number. Money is integer minor units; an overflow is `RULE_EVALUATION_ERROR`,
never a wrong amount. Currencies are never mixed in the cost estimate.

## Completion

Internal assessment, in this precedence order: `UNSUPPORTED` →
`NEEDS_USER_INFORMATION` → `NEEDS_OFFICIAL_VERIFICATION` → `OTHERWISE_COMPLETE`.
A missing user answer outranks an open official question because answering it may
remove the official question entirely.

A pathway is selected only for `OTHERWISE_COMPLETE`, and exactly one must apply
(`PATHWAY_MISSING` / `PATHWAY_AMBIGUOUS`). A pathway may organise presentation
freely but may not present a procedure before one it depends on.

Final status is then `COMPLETE`, or `COMPLETE_WITH_WARNINGS` when warnings exist
or the answer rests on STRONG_EVIDENCE alone. `caseType` is nullable and is never
a placeholder; `COMPLETE`, `COMPLETE_WITH_WARNINGS` and `UNSUPPORTED` all require
one.

## Errors

Closed union, structured codes, no business logic over free-text strings:

- `RULE_CONFIGURATION_ERROR` - the knowledge base is wrong.
- `ENGINE_INVARIANT_VIOLATION` - the engine's own assumptions were broken.
- `RULE_EVALUATION_ERROR` - the computation could not be carried out.

Normal outcomes are never errors: `NEEDS_USER_INFORMATION`,
`NEEDS_OFFICIAL_VERIFICATION`, `UNSUPPORTED`, `STRONG_EVIDENCE` and
`REUSE_UNKNOWN` all travel inside a successful decision.
