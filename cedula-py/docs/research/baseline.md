# Research baseline

This file records exactly which real-world content is present in the repository,
and in what form. Everything else is synthetic.

## The rule that governs this file

If a value is not in the approved research baseline, it does not go in. There is
no "reasonable assumption" entry, no "probably", and no inferred document list.

## What is present, and how

The baseline lives in `src/research/claims/baseline.ts` as **reference data**.
It is not a rule set, it is not loaded by the engine, and no seed publishes it.
It exists so Phase 4 can author rules from one reviewed list instead of prose.

`supabase/seed.sql` contains **no legal rules at all** - only country reference
data and the record of the open conflict below.

### Published official fees (carried as reference data)

| Key | Amount | Status |
|---|---|---|
| First cédula, foreigner | 8 500 Gs | STRONG_EVIDENCE |
| DNM Residencia Temporal | 2 926 925 Gs | STRONG_EVIDENCE |
| DNM Residencia Permanente | 2 926 925 Gs | STRONG_EVIDENCE |
| DNM Certificado de Radicación | 234 154 Gs | STRONG_EVIDENCE |
| DNM Prórroga Temporal | 1 287 847 Gs | STRONG_EVIDENCE |
| DNM Multa | 702 462 Gs | STRONG_EVIDENCE |
| Jornal baseline (index unit) | 117 077 Gs | STRONG_EVIDENCE |

### Europe MVP visa matrix (residence purpose)

`REQUIRED`: DE, AT, ES, FR, IT, PT, GB.
`NO VISA`: CH, NL, BE.

This is a country-scope statement. It says nothing about what an applicant must
then do.

### Narrative baseline statements

- Residencia Temporal is governed by **Ley 6984/2022** (CONFIRMED).
- Residencia Temporal is generally granted for up to two years (STRONG_EVIDENCE).
- Residencia Temporal can **in principle** provide access to a cédula
  (STRONG_EVIDENCE).
- A general pathway exists from Temporal to Permanente (STRONG_EVIDENCE).
- Published cédula delivery indication: 90 business days (STRONG_EVIDENCE) - an
  indication, not a guaranteed processing time.

## The open conflict

**Key:** `temporal-identificaciones-document-set`
**Status:** `CONFLICTING` + `OFFICIAL_VERIFICATION_REQUIRED`

Established: Residencia Temporal can open the way to a first cédula.

Not established: which documents the Identificaciones service requires **from a
temporal resident**. The published page covering first-cédula issuance is titled
for temporal *and* permanent residents, yet its published document list names
permanent-residence documents - *Certificado de Radicación Permanente* and
*Carnet de Admisión Permanente*. The exact temporal document set under
**Resolución 717/26** is therefore contested.

**This must not be resolved by substituting PERMANENTE with TEMPORAL.**

### How the system models it

- as a row in `research.research_conflicts` (status
  `OFFICIAL_VERIFICATION_REQUESTED`), seeded in every environment;
- as the case type `TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED`;
- as the verification code `TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET`, targeting
  the affected procedure;
- as a rule shape: an unresolved `DOCUMENT_REQUIREMENT` rule that states what
  needs verifying and carries **no document consequence**, so the engine produces
  `NEEDS_OFFICIAL_VERIFICATION` with an empty document list rather than an
  invented one.

Covered by `tests/engine/temporal-identificaciones.test.ts`, golden case SYN-002
and an end-to-end browser test.

## What is missing

The 71 Phase-2D golden cases are registered in `tests/golden/p2d-manifest.json`
and are all marked `SPECIFICATION_INPUT_REQUIRED`: their original fact and
expected-decision inputs were not present in the implementation working context,
and inventing them would have meant inventing law. A test enforces that the
registry stays complete and that no fixture can claim a case it does not have.
