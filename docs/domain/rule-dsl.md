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
| `DOCUMENT_STATE` | what papers the applicant already holds | document reuse, document formality, warnings, timelines |
| `ENTRY_READINESS` | evidence of entry available today | warnings, timelines |

`DOCUMENT_REQUIREMENT` is deliberately not in that second row. A formality rule
may look at a document the applicant holds - whether it needs an apostille is a
question about that document - but the requirement itself is decided without
looking, which is what makes "I already have my birth certificate" incapable of
deleting the legal requirement for a birth certificate.

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

## Resolution: a consequence or a question, never both

A payload carries a `RuleResolution`:

```
RESOLVED    -> consequence
UNRESOLVED  -> reason + verification { code, target }
```

The two are alternatives in the type, so an unresolved rule has nowhere to put
a consequence. That is stronger than a convention: there is no field to leak a
provisional legal statement through, in TypeScript, in the JSON schema, or in
the database, where a CHECK constraint additionally requires the resolution
state and the revision's evidence status to agree.

`precedence` lives in the payload too. What a rule says and what it overrides
are one statement, covered by one schema version and one bundle hash.

### Verification targets

An unresolved rule names what needs checking with the same selectors the
consequence families use:

| Target | Names |
|---|---|
| `CASE` | the case as a whole |
| `PROCEDURE` | a procedure selector |
| `DOCUMENT` | a document selector |
| `VISA_PURPOSE` | a visa purpose code, literally |
| `FEE_COMPONENT` | a procedure selector plus a component code |

The engine resolves the target against the decision it actually produced.
A target that matches nothing, or several things, is a rule configuration
error. There is deliberately **no fallback to `CASE`**: a rule that names a
procedure and cannot be pointed at one is not a general question about the
case, it is a rule that no longer matches the knowledge base, and widening its
target would hide exactly that. A target the decision explicitly ruled out is
dropped instead, because asking about something already ruled out is noise.

## Verification status

`CONFIRMED`, `STRONG_EVIDENCE`, `CONFLICTING`, `UNKNOWN`,
`OFFICIAL_VERIFICATION_REQUIRED`. There is no `OUTDATED`: whether a revision
still applies is decided by its effective window and publication status.

This is evidence metadata, not a decision channel. The engine reads the
payload's resolution; this field records how well the sources back it, and the
validator keeps the two consistent.

## Versioning

Every revision carries `payloadSchemaVersion`, currently `rule-payload@2.0`. The
version covers the *semantics* - AST meaning, operators, fact paths, date
semantics, resolver behaviour - not just the shape. No silent semantic change
under an unchanged version.

Product policies and pathway definitions version independently, as
`product-policy@1.0` and `pathway-definition@1.0`. The engine descriptor lists
which versions of each this build can interpret, and bundle preparation refuses
anything it does not recognise rather than reading it with the wrong
expectations.
