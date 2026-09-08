# Implementation deviations

Format per entry: Decision / Expected / Implemented / Reason / Risk /
Recommended follow-up.

## Architecture

**No known architecture deviations.**

Every architectural decision in the approved specification is implemented as
specified: the layer boundaries, the pure engine contract, three-valued logic,
the closed rule AST, decision slots with explicit-only precedence, direct
dominance without transitivity, content-derived keys, the five database schemas,
forced RLS, append-only evaluations, and the publication hash binding.

## Environment adaptations

These are properties of the machine this foundation was built on, not changes to
the design. Each is reversible by configuration alone.

---

**Decision:** Node.js 24 LTS is the runtime baseline.
**Expected:** build and test on Node 24.
**Implemented:** `package.json` declares `engines.node >= 24.0.0` and the CI
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

**Decision:** commit Supabase-generated database types and check for drift in CI.
**Expected:** `supabase gen types typescript --local` output committed.
**Implemented:** the `db:types` script exists; the generated file is **not**
committed, because generating it requires the Supabase CLI against a running
local stack (Docker). The architecture rule that keeps those types out of the
domain is in place and enforced regardless.
**Reason:** as above.
**Risk:** low. Nothing depends on the generated types yet.
**Follow-up:** generate and commit the types, and add the drift check to CI, in
the same change that brings the Supabase stack up.

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
