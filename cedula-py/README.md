# Cédula PY

A mobile-first web app / PWA that helps foreigners **understand and organise
their first Paraguayan cédula** - and says so plainly when something is not yet
officially confirmed.

This repository contains the **Phase 3 technical foundation**: a real domain
model, a validated rule language, a pure deterministic evaluation engine, a
PostgreSQL/Supabase persistence layer with row level security, security
boundaries, and the test architecture that keeps all of it honest. It is not the
finished product, and it does not ship a populated legal knowledge base.

## Scope

First cédula for foreigners. MVP country scope is Europe: DE, CH, AT, ES, FR, IT,
PT, NL, BE, GB. MERCOSUR is explicitly out of scope for this core.

## Stack

| | |
|---|---|
| Runtime | Node.js 24 LTS (CI baseline) |
| Framework | Next.js 16.3.4 (App Router, Turbopack) |
| Language | TypeScript 5.9.3, `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` |
| UI | React 19.2.8, Tailwind CSS 4.3.3 |
| Validation | Zod 4.5.4 |
| Database | PostgreSQL / Supabase (`@supabase/supabase-js` 2.116.0, `@supabase/ssr` 0.12.7) |
| Tests | Vitest 5.0.0, fast-check 4.9.0, Playwright 1.63.0, pgTAP |
| Package manager | **npm** with `package-lock.json` (no Yarn, no pnpm) |
| ORM | none - SQL migrations are the schema source of truth |

## Architecture at a glance

```
src/shared/          Result, brands, canonical JSON, SHA-256
src/domain/          validated primitives, branded ids, facts, decisions
src/rules/           rule AST, schemas, fact registry, bundle assembly
src/case-engine/     the pure evaluator - no I/O of any kind
src/application/     use cases and ports
src/infrastructure/  adapters: Supabase, pg, logging, env, hashing
src/auth/            authorization policy (pure)
src/research/        the approved research baseline as reference data
src/ui/ src/app/     Next.js App Router and components
supabase/            migrations, seed, pgTAP tests
tests/               unit · rules · engine · golden · property · application
                     architecture · security · persistence · e2e
```

Dependencies point inwards only. See
[docs/architecture/boundaries.md](docs/architecture/boundaries.md) - the rules
are enforced by `npm run check:boundaries` and by a merge-blocking test.

## Module boundaries

- `domain` and `case-engine` never import Next.js, React, Supabase, `pg` or any
  I/O module. The engine additionally never imports `zod`: bundles reach it
  already validated.
- `rules` never reaches a database.
- `application` depends on **ports**, never on adapters.
- `ui` can never import the privileged (service-role) client.

## Engine determinism

```ts
evaluateCase(facts, context, bundle, engine): Result<CaseEvaluationDecision, EngineError>
```

Same inputs → same decision, always. Independent of database row order, rule
array order, evidence order, scope discovery order and `Map` insertion order.
The engine reads no clock, no environment, no session and no database, and mints
no random identifiers. Derived keys (`rp1:` / `rd1:`) are pure functions of
semantic content.

Full contract: [docs/domain/engine-contract.md](docs/domain/engine-contract.md).

## Rule system

A persisted rule is **data**, interpreted by a closed eight-node AST - never
executed. No `eval`, no `new Function`, no JSONPath, no script rules.

- Three-valued logic: `UNKNOWN` and `UNANSWERED` are `INDETERMINATE`, never
  `FALSE`.
- Rules read a projection (`RuleFactView`) through a closed fact-path registry,
  partitioned into access domains so that a legal requirement rule cannot see
  what documents you already hold.
- Conflicts need **explicit** precedence (`EXCEPTION_TO` / `OVERRIDES`), applied
  directly and non-transitively. No numeric priority, no automatic specificity.
- Missing knowledge produces `REUSE_UNKNOWN`, `NEEDS_OFFICIAL_VERIFICATION` or a
  blocking question - never a guess.

Full description: [docs/domain/rule-dsl.md](docs/domain/rule-dsl.md).

## Local setup

```bash
cd cedula-py
npm ci
cp .env.example .env.local     # then fill in real values locally; never commit
npm run dev
```

### Environment variables

Names and placeholders live in `.env.example`. Nothing in this repository
contains a real secret.

| Variable | Where it may appear |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server |
| `NEXT_PUBLIC_SITE_URL` | browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only**, never a client bundle |
| `SUPABASE_DB_URL` | **server only** |
| `CEDULA_ENVIRONMENT` | `LOCAL` \| `PREVIEW` \| `PRODUCTION` |
| `CEDULA_AUTH_REDIRECT_ALLOWLIST` | exact trusted redirect origins |
| `CEDULA_TEST_DATABASE_URL` | local integration/persistence tests only |
| `CEDULA_SYNTHETIC_KNOWLEDGE` | enables the gated synthetic fixture route; refused in production |

### Supabase / database

```bash
supabase start          # requires Docker
supabase db reset       # applies supabase/migrations/*.sql, then seed.sql
supabase db lint
supabase test db        # pgTAP

# Without the Supabase CLI, against any local PostgreSQL 16+ with pgTAP:
export CEDULA_TEST_DATABASE_URL="postgresql://…"
npm run db:reset
npm run test:db
npm run test:persistence
```

Migrations are the **schema source of truth**. No schema change is ever made by
hand in a dashboard.

## Commands

```bash
npm run typecheck        npm run lint             npm run build

npm run test:unit        npm run test:rules       npm run test:engine
npm run test:golden      npm run test:property    npm run test:application
npm run test:architecture npm run test:security   npm run test:coverage
npm run test:integration npm run test:persistence npm run test:db
npm run test:e2e

npm run validate:rules   npm run validate:sources
npm run verify:bundle    npm run check:boundaries

npm test   # typecheck + lint + boundaries + rule/source/bundle gates
           # + unit, rules, engine, golden, property, architecture,
           #   security, application
```

`npm test` deliberately excludes `integration`, `persistence`, `test:db` and
`e2e`: those need a database or a browser, and a default test command that
silently skips half of itself is worse than one that states its scope.

## Security notes

Full baseline: [docs/security/baseline.md](docs/security/baseline.md).

- Server identity comes from verified claims (`getClaims()` / `getUser()`).
  `getSession()` is never the security identity.
- Supabase server clients are per request. Never a singleton.
- Admin authority lives in `security.admin_authorizations`, never in
  `user_metadata`. Privileged actions require AAL2 plus a live, fresh session.
- RLS is enabled **and forced** on every table in every schema. Evaluations are
  read-only to clients and append-only in the database.
- Runtime roles are NOLOGIN with no `SUPERUSER` and no `BYPASSRLS`. Every
  `SECURITY DEFINER` function pins `search_path = ''` and revokes `PUBLIC`.
- Per-request nonce CSP; private and admin responses are never shared-cacheable.
- Logging is allowlist-based: wizard answers cannot reach a log line.
- No secrets in the repository.

## Known research limitations

The knowledge base is **not populated**. `supabase/seed.sql` contains no legal
rules at all. The approved baseline is carried as documented reference data in
`src/research/claims/baseline.ts`, not as rules - see
[docs/research/baseline.md](docs/research/baseline.md).

### The Temporal Identificaciones conflict

Established: Residencia Temporal (Ley 6984/2022) can **in principle** open the
way to a first cédula.

Not established: which documents the Identificaciones service requires **from a
temporal resident**. The published page covering first-cédula issuance is titled
for temporal *and* permanent residents, yet its document list names
permanent-residence documents (*Certificado de Radicación Permanente*, *Carnet de
Admisión Permanente*). The exact temporal document set under **Resolución 717/26**
is therefore `CONFLICTING` + `OFFICIAL_VERIFICATION_REQUIRED`.

**This is not resolved by substituting PERMANENTE with TEMPORAL.** The system
models the conflict instead: the case type
`TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED`, the verification code
`TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET`, a seeded row in
`research.research_conflicts`, and an unresolved rule that states what needs
verifying and carries no document consequence. The result is
`NEEDS_OFFICIAL_VERIFICATION` with an **empty** document list rather than an
invented one.

## What is implemented

- Full domain model: validated primitives, branded identifiers, knowledge states,
  facts split into classification and readiness, case types, residence, fees,
  money in integer minor units.
- Rule DSL: closed AST with limits, fact-path registry with access domains,
  eleven payload families, Zod schemas, structural validation, precedence
  validation.
- Pure engine: three-valued evaluation, scopes, classification, product gate,
  procedures, documents, formalities, dependencies with DAG validation, document
  reuse, fees with index resolution, warnings, indeterminacy analysis, blocking
  issues, verification flags, completion frontier, pathway selection, canonical
  output.
- Persistence: five schemas, effective-window exclusion constraints, composite
  ownership integrity, append-only evaluations, bundle materialisation, the
  publication transaction with candidate-hash binding.
- Security: RLS matrix, runtime roles, SECURITY DEFINER hardening, request-scoped
  auth, admin authorization with AAL2 and liveness, CSP/CSRF/redirect controls,
  allowlist logging, erasure path.
- Testing: unit, rules, engine, golden, property, application, architecture,
  security, persistence, pgTAP, e2e.
- Basic app wiring: public shell, wizard seam, authenticated seam, admin
  boundary, evaluation API, PWA base.

## What is intentionally not implemented

- The production legal knowledge base. No rule content is seeded.
- The finished wizard UX and final route/checklist UI.
- Final production visual design.
- Legal content pages.
- Pro subscription, partner marketplace, RUC, driver's licence, banking, SIM,
  real estate.
- MERCOSUR.
- Anything belonging to Phase 4.

## Licence and disclaimer

Cédula PY explains official processes. It is **not legal advice**, and it says so
whenever something still needs official verification.
