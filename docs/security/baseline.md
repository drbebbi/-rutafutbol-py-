# Security and privacy baseline

## Identity

The authoritative server identity comes from **verified claims**
(`auth.getClaims()`), falling back to `auth.getUser()`, which asks the auth
server. `getSession()` is never the security identity - it returns whatever is in
a cookie the browser controls. A security test asserts the string `getSession()`
appears nowhere in `src/`.

Supabase server clients are created **per request**. A module-level client would
carry one user's session into the next user's request.

## Authorization

Administrative authority lives in `security.admin_authorizations` and nowhere
else. `user_metadata` is user-writable and is never consulted; `app_metadata` may
at most drive a UX hint.

Roles: `RESEARCHER`, `PUBLISHER`, `ADMIN`.

A privileged action requires:

1. the role for that action,
2. **AAL2**,
3. for `PUBLISH_RULE`, `CHANGE_ADMIN_ROLE`, `REVOKE_ADMIN` and
   `SECURITY_CONFIG_CHANGE`: a **live provider session** and an authorization
   check no older than five minutes.

A still-valid JWT is deliberately not sufficient: an administrator revoked a
minute ago still holds a cryptographically valid token, and liveness plus
freshness is what closes that window. Nobody may change their own roles.

## Database posture

Five schemas: `app` (per-user data, the only Data API surface), `core`
(published knowledge), `research`, `audit`, `security`. No Cédula PY table lives
in `public`, and `CREATE` on `public` is revoked.

Row level security is **enabled and forced on every table in every schema**,
including those with no policy at all - RLS on with no policy denies everything,
which is the correct default for `research`, `audit` and `security`.

- `app.user_cases`: four owner-scoped policies for `authenticated`. `anon` has no
  policy at all, because an anonymous case is never persisted.
- `app.case_evaluations`: **SELECT only**. There is no INSERT/UPDATE/DELETE
  policy and no INSERT grant; the authoritative write goes through
  `app.record_case_evaluation`, and an UPDATE trigger makes the table
  append-only even for a role that somehow held the privilege.
- Composite foreign key `(user_case_id, owner_user_id) → user_cases(id,
  owner_user_id)`: an evaluation can never be attached to somebody else's case.
- Ownership is immutable; a trigger rejects a transfer.
- `core.*` is publicly readable reference data; writes are admin-only.

Runtime roles `cedula_runtime_role` and `cedula_admin_runtime_role` are NOLOGIN
and hold neither `SUPERUSER` nor `BYPASSRLS`. The admin runtime may write
knowledge; it may **not** browse private user cases.

Every `SECURITY DEFINER` function pins `search_path = ''`, references every
object schema-qualified, and has `EXECUTE` revoked from `PUBLIC`. pgTAP asserts
both properties over the whole database.

Behind Supavisor transaction pooling there is no session affinity and no
server-side prepared-statement reuse; the direct-connection adapters use plain
text queries for exactly that reason (with `postgres.js`, this is the
`prepare: false` requirement).

## Web

- **CSP** is set per request by the proxy with a fresh nonce, so there is exactly
  one policy. `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`,
  `form-action 'self'`; `unsafe-eval` never appears in production. The admin
  route class tightens `frame-src` and `media-src` further.
- Also sent: `Strict-Transport-Security` (production), `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` (camera, microphone, geolocation,
  payment, USB all denied), `X-Frame-Options`.
- Private and admin responses carry `Cache-Control: private, no-store` and
  `Vary: Cookie, Authorization`. Nothing that can see a user's case is
  shared-cacheable.
- **CSRF**: Server Actions rely on the framework's origin protection; custom
  cookie-authenticated route handlers additionally require a same-origin
  `Origin` header, and a state change with no `Origin` is refused. GET/HEAD never
  mutate state.
- **CORS**: no `Access-Control-Allow-Origin: *` on cookie-authenticated APIs.
- **XSS**: React escaping; no `dangerouslySetInnerHTML` anywhere.
- **Open redirect**: `safeRedirectTarget` accepts relative paths and allowlisted
  absolute origins only, and rejects protocol-relative URLs, backslash tricks and
  non-HTTP schemes.

## Data classification

`PUBLIC | INTERNAL | PERSONAL | PERSONAL_HIGH_RISK | SECRET`, as a documented,
testable registry (`src/application/security/data-classification.ts`).

`PERSONAL_HIGH_RISK` covers `app.user_cases.facts_jsonb` and
`app.case_evaluations.input_snapshot_jsonb`: residence history, special-case
answers, protection status and combined migration context. Never in standard
logs, never in analytics, reachable only through an owner-scoped path.

## Logging

**Allowlist, not blocklist.** `redactForLog` keeps only allowlisted keys holding
scalars; everything else - including a key nobody has seen before - is redacted.
A second list names keys that must never be logged, and a test asserts the two
never overlap. The browser receives a code, a generic message and a correlation
id; stack traces, SQL and internal messages stay on the server.

## Secrets

None in the repository. `.env.example` holds names and placeholders only, and a
test asserts it. `SUPABASE_SERVICE_ROLE_KEY` is referenced only from
`server-only` modules plus the environment validator and the classification
registry, which name it without reading it. Environment validation failures
report variable **names**, never values.

## Erasure

Deleting a case removes the case and its evaluations (cascade) and writes a
`security.erasure_journal` row containing only the subject id, the timestamp, the
outcome and the scope. It never removes the evaluation bundle, rule revision,
source revision, fee index revision or product policy revision: that is shared,
non-personal knowledge, and destroying it would make every other user's stored
evaluation unexplainable.

Account deletion cannot cryptographically invalidate an access JWT that has not
yet expired. The system does not pretend otherwise: personal app data is deleted,
refresh/session state is revoked, the browser session is cleared, and every
privileged action re-checks session liveness.

## Rate limits and retention

Risk-based categories: `AUTH`, `ANONYMOUS_EVALUATION`,
`AUTHENTICATED_EVALUATION`, `CASE_MUTATION`, `ADMIN_READ`, `ADMIN_WRITE`,
`RULE_PUBLICATION`.

Retention defaults - **engineering defaults, not asserted legal periods**:
operational logs 30 days, security/abuse logs 90 days, security authorization
audit 365 days. The **knowledge publication audit has no expiry**: a stored
evaluation from three years ago cannot be explained without the knowledge it was
decided against.

## Privacy compliance

Not part of the immigration rule engine, and **not** claimed by this
implementation. Current privacy obligations, the Ley 7593/2025 transition, the
provider inventory, international processing, retention and incident
requirements are external work items. Nothing here should be read as "privacy-law
compliant".
