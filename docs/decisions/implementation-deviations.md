# Implementation deviations

Format per entry: Decision / Expected / Implemented / Reason / Risk /
Recommended follow-up.

## Architecture

The Phase 3 independent audit found architecture deviations that this document
had previously claimed did not exist. They are recorded below with what was
done about them, so the same claim cannot be made again from this file alone.

### Open

**Decision:** the Supabase-generated database types are committed and CI fails on
drift (Phase 3D).
**Expected:** `src/infrastructure/supabase/database.types.ts` in version control.
**Implemented:** the CI job, the generation script and the drift check all
exist; the file itself is **not** committed. `supabase gen types` runs pg-meta
in a container, and the Docker daemon is not available in the implementation
environment - with or without `--db-url`.
**Reason:** environment. Writing the file by hand was rejected: a file that
claims to be generated output but is not would make the drift check fail
permanently and for a misleading reason.
**Risk:** low today - nothing compiles against those types yet - and moderate
once something does, because until the file is committed CI has nothing to
compare against and the drift check reports the file as uncommitted.
**Follow-up:** run `npm run db:types` on a machine with Docker and commit the
result. The CI step already fails loudly until that happens.

### Resolved by the Phase 3 audit fix pass

These were real deviations. Each is listed with what was actually wrong,
because "fixed" is only meaningful next to what it was.

| # | Deviation | Resolution |
|---|-----------|------------|
| 1 | The application lived under `repository/cedula-py`, not at a repository root, and its CI workflow needed a `working-directory` shim. | The application is the repository root; the unrelated RutaFútbol site moved intact into `rutafutbol-py/` and is excluded from the audit archive. |
| 2 | `app.record_case_evaluation` was executable by `authenticated`, so a client could author a decision and have it stored as evidence. | EXECUTE belongs to the internal runtime roles only. The owner is a verified server input the database checks against the case. |
| 3 | `anon` and `authenticated` were granted membership in `cedula_runtime_role`. | Removed. The migrations create no credential; membership is granted to environment-specific login principals outside version control. pgTAP checks MEMBER *and* SET reachability. |
| 4 | Both browser roles held SELECT on all of `core`, contradicting "app is the only Data API surface". | Removed, along with the schema USAGE grant. Published knowledge is served through a server read path. |
| 5 | Administrative authority was read through the requester's own request-scoped client. | `AdminAuthorizationRepositoryPort` with a server-only internal adapter; a failed lookup yields no identity rather than an identity with no roles. |
| 6 | `core.publish_rule_revision` took the "actual" candidate hash from its caller, so the staleness comparison could never fail. | The publication transaction locks, reassembles the candidate with the production assembly, hashes it and compares. The caller can state only what it approved. |
| 7 | An unresolved rule still carried a fully-formed consequence in its payload. | `RuleResolution` makes a consequence and a verification request mutually exclusive in the types, the zod schema and a database check constraint. |
| 8 | Verification targets fell back to `CASE` whenever the declared target could not be supplied. | Targets are resolved against the produced decision; nothing and several-things are both rule configuration errors. |
| 9 | ProductPolicy was one function with an open-ended result, and PARTIAL / RESEARCH_REQUIRED fell through to a default. | Three separated stages, a closed effect union that cannot state a legal requirement, and a configuration error when a coverage state that needs governing has none. |
| 10 | The engine descriptor did not say which authored schema versions the build could interpret. | Per-artefact supported-version lists, deduplicated and sorted; bundle preparation checks against them. |
| 11 | Product policies and pathway definitions had no payload schema version. | Both carry one, in the domain, the database, the bundle and the hash. |
| 12 | DOCUMENT_FORMALITY could not read document state, so a formality about a held document could not see it. | Formality rules may read `DOCUMENT_STATE`. Document *requirements* stay confined to `CASE_LEGAL`, so readiness still cannot remove what the law asks for. |
| 13 | Source, evidence and classification contracts lagged behind Phase 3C. | Publication date, effective window, supersession, capture confidence and notes on a source revision; role, claim summary and quote on evidence; reason codes and typed provenance on a classification. |
| 14 | The synthetic-knowledge route defaulted a missing `CEDULA_ENVIRONMENT` to LOCAL and treated any non-PRODUCTION value as safe. | An explicit environment allowlist, a production-build refusal, and a named switch - none with a default. Proved end to end against a real production build. |
| 15 | The application used `pg`, not Postgres.js as decision 180 specified. | Postgres.js with `prepare: false`. `pg` remains a devDependency for the persistence harness only, which deliberately drives raw session state. |
| 19 | The publication safety corpus silently skipped cases it could not evaluate while still reporting `corpus.length` as `totalCases`. | An unevaluable case fails validation; `totalCases` counts what was evaluated. |
| 22 | A persistence test asserted that the case owner *could* write an evaluation. | It now asserts the opposite, which is what the privilege model says. |

## Environment adaptations

These are properties of the machine this foundation was built on, not changes to
the design. Each is reversible by configuration alone.

---

**Decision:** Node.js 24 LTS is the runtime baseline.
**Expected:** build and test on Node 24.
**Implemented:** `package.json` declares `engines.node >= 24 <25` and the CI
workflow pins Node 24. The local implementation environment had Node 22.22.2
available, so local gate runs were executed there; Next.js 16.3.4 requires
`>= 20.9.0`, so nothing in the toolchain was downgraded.
**Reason:** no Node 24 runtime was installable in the implementation sandbox.
**Risk:** low. No Node-24-only API is used; the CI matrix is the authoritative
runtime.
**Follow-up:** confirm the first CI run on Node 24 is green.

---

**Decision:** local database work runs on the Supabase CLI stack.
**Expected:** `supabase start`, `supabase db reset`, `supabase db lint`,
`supabase test db`.
**Implemented:** migrations, seed and the pgTAP suite were applied and executed
against a local PostgreSQL 16 server with pgTAP installed, driven by
`scripts/db-reset.ts` and `scripts/run-pgtap.ts`. Migration `0000` is a
compatibility shim that creates the Supabase-provided roles and `auth.uid()` /
`auth.jwt()` **only when the platform has not already provided them**, so the
identical migration set applies to both a plain PostgreSQL instance and a
Supabase project.
**Reason:** the Docker daemon is not available in the implementation sandbox, and
the Supabase CLI stack requires it.
**Risk:** low-moderate. The schema, constraints, RLS policies, grants and
SECURITY DEFINER hardening are all exercised for real; what is not exercised is
Supabase's own platform preamble and PostgREST behaviour.
**Follow-up:** run `supabase db reset`, `supabase db lint` and `supabase test db`
in CI against the real stack before launch, and confirm the shim is a complete
no-op there.

---

**Decision:** the Playwright release matrix is mobile Chromium, mobile WebKit and
desktop Chromium.
**Expected:** all three run.
**Implemented:** desktop Chromium and mobile Chromium run and pass. Mobile WebKit
is configured but was **not run**: no WebKit browser binary exists in the
implementation environment (`/opt/pw-browsers/webkit-2359` is absent), and the
environment forbids downloading browsers. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` was
used to point at the available Chromium build.
**Reason:** browser binaries are provisioned by the environment.
**Risk:** moderate for iOS Safari specifically - a mobile-first PWA needs that
lane.
**Follow-up:** run the full matrix in CI, where Playwright installs its own
browsers.

---

**Decision:** the Phase 2D golden corpus is 71 approved cases.
**Expected:** P2D-001 .. P2D-071 materialised and run by the golden suite.
**Implemented:** the manifest records all 71 identities and marks every one
`SPECIFICATION_INPUT_REQUIRED`; `npm run release:gate` exits non-zero and prints
`P2D_GOLDEN_CORPUS_INCOMPLETE: 0/71`, and it has its own CI job so the signal
cannot be confused with a regression elsewhere.
**Reason:** the original Phase 2D inputs are not in the repository. Cases were
deliberately not invented: a golden corpus of made-up expectations would prove
the engine agrees with itself.
**Risk:** high for release readiness, and deliberately visible. The engine
mechanics are covered by the synthetic golden, property and engine suites; what
is not covered is agreement with the approved expectations.
**Follow-up:** supply the original inputs. Until then no build can be described
as complete.

---

**Decision:** end-to-end tests run against a production build.
**Expected:** one server, `next start`.
**Implemented:** two. `next start` forces `NODE_ENV=production`, and the
synthetic-knowledge route is now refused unconditionally in a production build,
so the specs that drive that route run against a development server while a
production build runs alongside on its own port - and one spec uses it to prove
the route really is refused there.
**Reason:** the fixture route's gate is itself under test, and a claim about a
production build can only be made by running one.
**Risk:** low-moderate. The specs that exercise the synthetic route no longer
run against the production build; the security-header, caching and routing
specs still do, and gain a production-build assertion they did not have.
**Follow-up:** when a seeded knowledge database is available in CI, move the
wizard specs onto the real `/api/evaluate` route against the production build
and retire the development-server lane.

## Design notes that are choices, not deviations

- **Product-scope case types take routing precedence.** When product coverage
  says a country is out of scope, or the applicant has held a cédula before, the
  reported `caseType` is `COUNTRY_NOT_SUPPORTED` / `NOT_FIRST_CEDULA` even if a
  classification rule also fired. A terminal routing decision has to be coherent;
  the legal statements the rules produced are untouched, only the routing label
  changes.
- **An unclassifiable case reports `NEEDS_OFFICIAL_VERIFICATION`** with
  `CASE_CLASSIFICATION_UNCONFIRMED` rather than `COMPLETE` with a null case type.
  Saying "we cannot classify this" is honest; inventing a case type is not.
- **A confirmed winner silences everything it directly dominates**, for all
  purposes - not only contradicting resolved rules, but also unresolved and
  indeterminate ones. A rule that could not have changed the answer should not be
  able to raise a verification request or block on a fact.
