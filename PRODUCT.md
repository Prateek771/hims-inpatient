# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One hospital's inpatient staff: Admin, admission/reception, assigned nurses and shift coordinators, Pharmacy, Insurance and Billing/Cashier. Doctors provide clinical decisions outside this MVP; routine Doctor login is not required. Patients have no account or mobile-alert channel.

## Product Purpose

Coordinate each admission episode from arrival to actual hospital exit: accountable work, medicine charges/returns, deterministic money, documents and physical bed readiness. Success means staff can identify the patient, blocker, owner and next action without confusing authorization, cash, vacancy and exit.

## Operating Context

Hospital staff use shared episode records across shifts. Staff verify insurance through existing external channels. Nurses record named external Doctor instructions, coordinate applicable checks and hand over care. Admin/Billing authorizes final finances. A designated nurse maintains Doctor availability separately from attendance.

## Capabilities and Constraints

The controlling [scope](docs/PROJECT_SCOPE.md) records the 15 October 2026 approved MVP. The Next.js/PostgreSQL/Better Auth/LangGraph application implements this coordination flow for new version 2 episodes. Historical version 1 episodes retain their original clinical, stock and sequential-clearance contracts. The [implementation progress](docs/agent/MVP_IMPLEMENTATION_PROGRESS.md) distinguishes passed checks from pending database/runtime release gates. Preserve accounts/credentials; no reset/reseed, new external integration or deployment.

Preserve patient/staff identities, old UHIDs, applied migration bytes, financial/clinical evidence, document versions, private files and credentials. AI can assist paperwork only. Humans retain clinical, coverage, money and clearance authority. No new payer/payment integration.

## Evidence on Hand

Owner-confirmed rules and source priorities are in the [handoff](docs/agent/MVP_DASHBOARD_HANDOFF.md). Existing designs and historical acceptance evidence are retained. All new design examples are fictional. No hospital policy, production readiness, real staff authorization or live patient-flow validation is implied.

## Product Principles

- Keep one patient episode and attributable history across the journey.
- Separate external clinical authority from the staff member recording it.
- Separate accepted insurer responsibility, receivable and actual cash.
- Preserve useful billing, auth, audit, beds and history foundations.
- Make pending work and accountable next actions visible.

## Open Decisions

Single names use one initial; unknown emergency identities use UN plus seven digits and retain that identifier after identification. Hospital policies, real access, tariffs, backup/retention, TLS and live providers remain unresolved. These do not block the fictional Admin dashboard review.
