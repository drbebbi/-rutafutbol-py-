# Module boundaries

Enforced twice: by `npm run check:boundaries` (a merge gate that fails fast) and
by `tests/architecture`, both driven from the same rule set in
`scripts/lib/boundaries.ts`.

## The rules

| Layer | May not import | Why |
|---|---|---|
| `src/domain` | Next.js, React, Supabase, `pg`, `node:fs`/net/http/child_process, `src/app`, `src/ui`, `src/application`, `src/case-engine`, `src/rules` | The domain is the vocabulary. If it knew about a framework, the vocabulary would be shaped by the framework. |
| `src/rules` | Next.js, React, Supabase, `pg`, I/O modules, `src/app`, `src/ui`, `src/application`, `src/case-engine` | A rule definition is data. It must be readable and validatable without a database. |
| `src/case-engine` | all of the above **plus `zod`** | The engine performs no I/O and parses no untrusted input: bundles arrive already validated. |
| `src/application` | Next.js, React, Supabase, `pg`, `src/infrastructure`, `src/ui` | The application layer talks to **ports**; adapters implement them. |
| `src/ui` | anything matching `privileged`, `@supabase/supabase-js`, `pg` | The UI must not be able to reach the service-role client. |
| `src/auth` | Next.js, React, `src/infrastructure`, `src/ui` | Authorization policy is pure and unit-testable. |

The scanner reads static imports, dynamic `import()` and `require()`.

## Why the engine may not import `zod`

Schema validation is a *boundary* activity. If the engine could parse, it would
be tempting to let a half-validated bundle in "just this once", and the guarantee
that an engine error means a knowledge-base defect - not a malformed payload -
would be gone. `prepareEngineReadyBundle` is the only door in.

## Why the application layer may not import infrastructure

`src/application/ports/ports.ts` declares `ClockPort`, `HashPort`,
`KnowledgeReadPort`, `EvaluationBundleStorePort`, `UserCaseRepositoryPort` and
`CaseEvaluationRepositoryPort`. Services take these as parameters. That is what
makes `tests/application` able to test the whole evaluation use case - including
"the effective local date that was actually used is the one that gets
persisted" - with no database at all.

## Route ownership

`src/app/(public)/page.tsx` owns `/`. There is deliberately no
`src/app/page.tsx`: two files claiming one route is a build-time ambiguity.
