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
- Local Git initialized on `main`; initial scope/design/source commit: `7f42681c2fe1fd3a3bf6d5a69a8ab25a491f2082`.
- Private GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient), default branch `main`, `origin` = `https://github.com/Prateek771/hims-inpatient.git`. Privacy and the initial remote commit were verified through GitHub CLI with network access.
- Attached managed worktree: `C:\Users\prate\.codex\worktrees\hims-development\INS`, branch `codex/hims-development`. Use this checkout for development; the primary folder remains on `main`. Obtain the current attachment/path from Codex if it is later moved or archived.
- The task's restricted shell may not recognize this worktree outside its initial writable roots. Verification with full repository access confirmed it is a valid clean linked worktree; do not change `core.bare` or rebuild Git metadata in response to that sandbox symptom.
- The proposed [implementation plan](../superpowers/plans/2026-10-09-hims-inpatient.md) and [tooling review](../TOOLING.md) are saved; all implementation tasks remain unchecked. No application code, product packages, schema or running service exists yet. Application checks are not available; commands in the plan are future scripts, not passed checks.

## Navigation and checks

| Need | Reference/check |
|---|---|
| Agent rules | [AGENTS.md](../../AGENTS.md) |
| Proposed build tasks / agent ownership | [Implementation plan](../superpowers/plans/2026-10-09-hims-inpatient.md) |
| Skills, framework packages and Graphify/Next.js tools | [Tooling review](../TOOLING.md) |
| Product sections, roles, owner decisions and source conflicts | [PROJECT_SCOPE.md](../PROJECT_SCOPE.md) |
| Approved role screens and Figma locators | [DESIGN_REFERENCE.md](../DESIGN_REFERENCE.md) |
| Preserved original sources and integrity hashes | [Source index](../reference/README.md) |
| Documentation/setup verification | Local-link existence, source SHA-256 comparisons, `git diff --check`, staged file review, `git status`, remote/head verification and ignore checks |
| Future application checks | Record actual commands here after application setup; none have been defined or run |

Keep this record compact and current after material verified changes. Preserve decision provenance; clearly label defaults/unknowns in the scope. Do not store secrets, patient records or guesses about completed software.
