# Testing strategy

## Projects

Vitest logical projects, split by what they are allowed to touch:

| Project | Location | Touches a network or database? |
|---|---|---|
| `unit` | `tests/unit` | no |
| `rules` | `tests/rules` | no |
| `engine` | `tests/engine` | no |
| `golden` | `tests/golden` | no |
| `property` | `tests/property` | no |
| `application` | `tests/application` | no |
| `architecture` | `tests/architecture` | no (reads source files) |
| `security` | `tests/security` | no (reads source files and config) |
| `integration` | `tests/integration` | **yes** - real PostgreSQL |
| `persistence` | `tests/persistence` | **yes** - real PostgreSQL |

The pure projects never reach an authority's website, or any network at all.
`integration` and `persistence` are excluded from the default run and skip
themselves cleanly when `CEDULA_TEST_DATABASE_URL` is unset.

Plus: `supabase/tests/database` (pgTAP) and `tests/e2e` (Playwright).

## What each layer proves

- **unit** - primitives reject what they should, `Result` behaves, canonical JSON
  is key-order independent and rejects what JSON cannot represent, and the pure
  SHA-256 agrees with `node:crypto` (a boundary case at 55 bytes caught a real
  padding bug).
- **rules** - the AST accepts every node kind and rejects everything else;
  complete three-valued truth tables; the fact registry maps every indeterminable
  path onto a closed blocking-issue code; document readiness is unreachable from
  legal families.
- **engine** - date goldens (`2024-02-29 + 1 year → 2025-02-28`), procedures and
  target resolution, the precedence suite, the dependency DAG, reuse, fees,
  product coverage, canonical ordering, and the Temporal Identificaciones case.
- **golden** - JSON fixture → schema → mapper → domain → engine → canonical test
  projection → expected comparison, with the fixture contract deliberately
  separate from the public DTO and from any persistence row.
- **property** - determinism, permutation invariance, canonicalisation
  idempotence, key stability, procedure dedup, provenance ordering, DAG
  invariants. Seeds are **fixed and versioned** (`tests/property/seeds.ts`): a
  property test that picks a fresh seed each run makes CI flaky and failures
  unreproducible.
- **application** - authorization, redirect safety, CSRF, logging redaction,
  environment validation, publication validation, and the evaluation use case
  against in-memory ports.
- **architecture** - the import boundaries, as a merge gate.
- **security** - posture assertions over source and configuration.
- **persistence / pgTAP** - RLS matrix, grants, constraints, append-only
  evaluations, publication transaction, bundle materialisation, REPEATABLE READ.
- **e2e** - system wiring only, against a controlled synthetic fixture route.

## The precedence suite

Its most important case:

```
A overrides B,  B overrides C,  nothing says A overrides C
three distinct consequences   →  DECISION_CONFLICT
```

Precedence is not transitive, `STRONG_EVIDENCE` cannot suppress a contradicting
confirmed rule, and an unresolved rule cannot suppress anything. Every
permutation of the three-rule set is asserted to give the same answer.

## Golden fixtures

`tests/golden/cases/*.json`, validated by their own Zod schema and mapped through
their own mapper. `SYN-nnn` are synthetic. `P2D-nnn` are the permanent Phase-2D
identities, registered in `p2d-manifest.json`; all 71 are currently
`SPECIFICATION_INPUT_REQUIRED` and a test forbids a fixture from claiming one it
does not have.

## No test gaming

Not used anywhere: `test.skip` to get green, `test.todo` for a required feature,
`test.only`, removed assertions, lowered thresholds, catch-and-ignore, or
behaviour hard-coded to a fixture id.

## Coverage

Thresholds (`vitest.config.ts`), applied per glob:

| Scope | Lines | Statements | Functions | Branches |
|---|---|---|---|---|
| `src/case-engine/**` | 95% | 95% | 95% | 90% |
| `src/rules/**` | 95% | 95% | 95% | 90% |

### Coverage suppressions

The V8 provider does not model unreachable code, so a handful of invariant guards
are marked `/* v8 ignore next 3 -- <reason> */`. Every one is listed here, and
every one is a guard that cannot be reached through a validated bundle:

- `procedure-stage`, `document-stage` (×2), `dependency-stage`, `fee-stage`:
  "slot key was registered above" lookups that exist so a future refactor fails
  loudly instead of silently dropping a decision.
- `fact-paths.requiredRuleScopeForPath`: unreachable for `RuleFactPath`-typed
  input; the throw guards a caller that bypasses the type.
- `rate-limit.policyFor`, `retention.retentionFor`, `cache-policy.policyFor`:
  lookup tables that are exhaustive over their unions.

Family-narrowing guards (`if (payload.family !== "PROCEDURE") continue;`) were
**removed** rather than suppressed: instances are grouped by family before the
loop, so the branch was dead code, and a documented cast records the invariant
without inventing an unreachable path.

## Running

```bash
npm run test:unit          npm run test:rules        npm run test:engine
npm run test:golden        npm run test:property     npm run test:application
npm run test:architecture  npm run test:security     npm run test:coverage
npm test                   # typecheck, lint, gates, all non-database projects

# require CEDULA_TEST_DATABASE_URL
npm run db:reset && npm run test:db && npm run test:persistence
npm run test:integration
npm run verify:shim        # migration 0000 is a no-op on an existing platform

# configuration gates, no database needed
npm run verify:exposure    # the Data API exposes only `app`
npm run release:gate       # fails while the Phase 2D corpus is incomplete

# starts both a development server and a production build
npm run build && npm run test:e2e
```

## The release gate

`npm run release:gate` exits non-zero while any of the 71 approved Phase 2D
golden cases is still marked `SPECIFICATION_INPUT_REQUIRED`, printing
`P2D_GOLDEN_CORPUS_INCOMPLETE: x/71`. It runs as its own CI job so its failure
is attributable, and it has its own test so it cannot be reduced to a warning.

The distinction it protects is worth stating plainly: the golden suite passing
with synthetic cases means the engine agrees with fixtures written alongside
it. It does not mean the engine agrees with the approved expectations, and no
other gate in this repository can tell the difference.

## Two servers for end-to-end tests

The synthetic-knowledge fixture route is refused unconditionally in a
production build, so the specs that drive it run against a development server.
The specs that make claims about headers, caching and the fixture route's own
refusal run against a production build started alongside on its own port: a
claim about what ships has to be tested on what ships.
