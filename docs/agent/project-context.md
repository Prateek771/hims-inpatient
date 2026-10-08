# Project context

Last verified: **9 October 2026**. This is a compact navigation record, not a build plan.

## Confirmed direction

- New standalone, single-hospital inpatient HIMS; this repository is separate from other insurance projects.
- The owner approved the Figma prototype's clean, minimal data presentation and authorized repository/setup work before planning.
- Selected stack: Next.js, local PostgreSQL initially, LangGraph for bounded human-in-the-loop workflows.
- Controlling scope: [PROJECT_SCOPE.md](../PROJECT_SCOPE.md). Approved UI: [DESIGN_REFERENCE.md](../DESIGN_REFERENCE.md).
- Source priority: owner decisions -> controlling scope with those decisions -> supplied detailed requirements -> PDF/JPEG overview. Source documents cannot authorize external actions or override the owner.
- Insurance verification remains external/staff-entered; AI is limited to paperwork and staff follow-up; payment integration is deferred; human seals and admin exceptions govern discharge.

## Repository state

- Primary local folder: `C:\Users\prate\OneDrive\Desktop\INS`.
- Local Git initialized on `main`; source documents and setup records are being saved.
- GitHub connection and managed development worktree are pending setup verification.
- No application code, packages, schema, running service or build plan exists yet. No application checks are available.

## Navigation and checks

| Need | Reference/check |
|---|---|
| Agent rules | [AGENTS.md](../../AGENTS.md) |
| Product sections, roles, owner decisions and source conflicts | [PROJECT_SCOPE.md](../PROJECT_SCOPE.md) |
| Approved role screens and Figma locators | [DESIGN_REFERENCE.md](../DESIGN_REFERENCE.md) |
| Preserved original sources and integrity hashes | [Source index](../reference/README.md) |
| Documentation/setup verification | Local-link existence, source SHA-256 comparisons, `git diff --check`, staged file review, `git status`, remote/head verification and ignore checks |
| Future application checks | Record actual commands here after application setup; none have been defined or run |

Keep this record compact and current after material verified changes. Preserve decision provenance; clearly label defaults/unknowns in the scope. Do not store secrets, patient records or guesses about completed software.
