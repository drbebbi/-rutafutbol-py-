# Architecture overview

Cédula PY is a mobile-first PWA that helps foreigners understand and organise
their **first Paraguayan cédula**. This repository holds the Phase 3 technical
foundation: a real domain model, a validated rule language, a pure deterministic
evaluation engine, a PostgreSQL/Supabase persistence layer with row level
security, and the test architecture that keeps all of it honest.

## The one idea everything else follows from

A legal answer is only worth giving if you can say **where it came from** and
**how sure it is**. Every design decision below exists to protect that:

- rules are *data*, interpreted by a closed evaluator - never code;
- an unknown answer stays unknown (three-valued logic), it never collapses to
  "no";
- a contradiction between sources produces `NEEDS_OFFICIAL_VERIFICATION`, not a
  guess;
- an evaluation is a pure function of its inputs, and those inputs are stored,
  so a decision from two years ago can be re-derived and explained today.

## Layers

```
src/
  shared/          Result, brands, canonical JSON, SHA-256      no dependencies
  domain/          types and validated primitives               -> shared
  rules/           rule DSL, schemas, bundle assembly           -> domain, shared, zod
  case-engine/     the pure evaluator                           -> domain, rules, shared
  application/     use cases and PORTS                          -> domain, rules, engine
  infrastructure/  adapters: Supabase, pg, logging, env         -> application ports
  auth/            authorization policy (pure)                  -> domain
  research/        the approved baseline as reference data      -> domain
  ui/ app/ pwa/    Next.js App Router, components, PWA          -> application
```

Dependencies point **inwards only**. `scripts/check-boundaries.ts` and
`tests/architecture` enforce it as a merge gate; see
[boundaries.md](./boundaries.md).

## The evaluation pipeline

Everything impure happens *around* the engine, never inside it.

```
                       ── preflight (application layer) ──
 UserCaseFacts ──▶ validate
 clock ──────────▶ EvaluationContext { evaluatedAt, jurisdictionTimeZone }
                        │
                        ▼   derived exactly once
                   EvaluationExecutionContext { …, effectiveLocalDate }
                        │
 knowledge port ──▶ EvaluationBundleContent for that same effectiveLocalDate
                        │
                   prepareEngineReadyBundle  (schema, structure, precedence,
                        │                     eligibility, effective windows)
                        ▼
 ══════════════════ PURE ENGINE ══════════════════════════════════════════
   project RuleFactView
   structural modifiers → special-case guard → product coverage precheck
   classification (case type, residence, visa)
   procedure rules → slot resolution → RequiredProcedureKey
   document rules  → slot resolution → RequiredDocumentKey → formalities
   dependency rules → DAG validation
   document reuse → fees → fee index → warnings
   indeterminacy analysis → blocking issues + verification flags
   completion assessment → pathway selection → canonical output
 ══════════════════════════════════════════════════════════════════════════
                        │
                        ▼
                CaseEvaluationDecision  (no persistence ids, ever)
                        │
 bundle store ◀─────────┤ materialise bundle (content hash)
 evaluations  ◀─────────┘ record via app.record_case_evaluation
```

Evaluation is **forward-only**: nothing produced late in the pipeline feeds back
into an earlier legal condition.

## Reproducibility

Same `UserCaseFacts` + same `EvaluationExecutionContext` + same bundle content +
same `EngineDescriptor` = same `CaseEvaluationDecision`. This holds regardless of
database row order, rule array order, evidence order, scope discovery order or
`Map` insertion order, because every collection the engine emits is sorted by an
explicit canonical identity and every derived key is a function of semantic
content.

The engine never reads a clock, an environment variable, a session or a
database, and never generates a random identifier.

## Knowledge lifecycle

```
research claim ─▶ review ─▶ APPROVED revision
                               │
                     PublicationValidationService
                     (schema, fact access, evidence, precedence, cycles,
                      bundle semantics, conflicts, safety-corpus impact)
                               │  candidateBundleHash
                               ▼
                  core.publish_rule_revision(approvedHash, actualHash)
                    - refuses on STALE_PUBLICATION_VALIDATION
                    - closes the predecessor's open window
                    - writes an audit event
```

Production rule publication never starts a test runner.

## What this release deliberately is not

A finished wizard, a finished route UI, a populated legal knowledge base, or a
statement that any particular document is required in Paraguay. See the README
section "What is intentionally not implemented".
