# Local UI publication and branch cleanup — 21 October 2026

## Authorized scope

The owner requested publication of all pending local UI work, preserving existing hospital data/accounts, and only `main` plus the existing development branch on GitHub. The development branch remains `codex/hims-development`; this checkout stays on it. No Vercel deployment, ordinary database migration, reset, reseed or password change is authorized by this publication.

Publish the reviewed six-dashboard UI, supporting server projections and unit tests, transcript/design history, fictional training guides and five previously delivered PDFs. The fresh-clone setup remains documented in [CLONE_DEMO](../CLONE_DEMO.md): it generates an independent fictional dataset and fresh private logins, rather than copying the owner's current database.

## Runtime and preservation evidence

- Current `web/src` exactly matches the running reviewed localhost preview's source fingerprint: `618fdbe3bb1628491c2d5967f91bf5b60459fd1561e91cc8d23c37ea224e9e6a`.
- Copied preview: `tmp/local-preview-task21-618fdbe`; BUILD_ID `-gnbRBLWKF0VZ-pNwtbvr`. Publishing source does not restart the local app or tunnel.
- A read-only pre-publication snapshot covers all 96 ordinary/native tables and 142 private/migration files. Hashes and the post-publication comparison remain ignored under `tmp/github-release-2026-10-21/`.
- All three preserved requirements-reference hashes match `docs/reference/SHA256SUMS.txt`.
- Independent source review found no release blocker. Role/assignment checks and mutation authority remain enforced on the server; no schema or seed-input changes accompany the UI.
- Independent artifact review inspected pending raw files and extracted PDF/DOCX text against 13 actual private credential values, with no matches. Published walkthrough patients are fictional. No screenshot OCR claim is made. Private evidence/credential targets remain ignored; local design-tool cache is also ignored.
- Local unit verification initially passed 175 of 177 tests. Two unchanged child-process import checks exceeded the existing five-second test limit on this Windows installation; a focused serial rerun passed the paperwork import but the room-worker import still timed out. No assertion or timeout is weakened. Exact-commit CI must pass the full suite before integration into `main`.
- Local lint, TypeScript checks and production build passed. The staged release contains no private runtime paths; source still exactly matches the running preview. Whitespace checks passed after removing three extra blank lines from historical design sources.

## Preserve commits before removing branches

The four additional remote heads each contain one dependency-only proposal based on the existing main checkpoint. No unique UI implementation needs merging from them. Archive these exact commits with annotated Git tags and retain an ignored verified `git bundle --all` before deletion:

| Proposal branch suffix | Commit | Archive tag |
|---|---|---|
| `web/langsmith-0.10.11` | `a2dacb1480ffda55523bf3726b58da41915fcc3f` | `archive/2026-10-21/dependabot-langsmith-0.10.11` |
| `web/types/node-26.6.5` | `87049d9026acce80327430388fdb88b656b75cd2` | `archive/2026-10-21/dependabot-node-26.6.5` |
| `web/vitest-5.0.4` | `2153555da89c7695f79912c5e83546ac342f1060` | `archive/2026-10-21/dependabot-vitest-5.0.4` |
| `web/zod-4.6.6` | `7dfef8601a00ce8b0e23702a48c446d5c39416e9` | `archive/2026-10-21/dependabot-zod-4.6.6` |

All branch names above start with `dependabot/npm_and_yarn/`. Publish the pending source before deleting any branch. Integrate `main` only after its exact development commit passes GitHub Checks; use normal fast-forward pushes. Branch deletion must compare each expected head SHA so newer work cannot be silently removed. Close the four corresponding dependency PRs without merging their optional upgrades.

Routine Dependabot version PR creation is paused with `open-pull-requests-limit: 0` for npm and GitHub Actions, preventing immediate recreation of those branches. Security settings are unchanged; GitHub documents the security-update limit separately in the [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#open-pull-requests-limit). This does not promise that security updates can never create a branch.

The immutable release commit, exact CI result, final remote heads and post-publication preservation result are verified live during execution; this record describes the release evidence and required sequence rather than claiming those later actions have already completed.
