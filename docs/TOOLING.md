# Tooling for this HIMS project

Inspected **9 October 2026**. Choose tools that reduce repeated work or verify an important boundary; installing more agent frameworks does not itself make code smaller or correct. Product dependencies are added at the task that needs them, with a lockfile and observed checks.

## Already available on this computer/session

| Tool/skill | Verified state | Use here |
|---|---|---|
| `personal-project-workflow` | Skill and `agents/openai.yaml` read at `C:\Users\prate\.agents\skills\personal-project-workflow`; implicit invocation enabled | Already installed; use for project understanding, minimal complete changes and evidence-based checks. No reinstall/copy into the repo |
| Ponytail | Installed skill read at `C:\Users\prate\.codex\skills\ponytail\SKILL.md` | Prefer native controls, constraints and existing libraries; retain money/access/error checks |
| Superpowers | Installed skills under `C:\Users\prate\.codex\plugins\cache\superpowers-dev\superpowers\6.4.2\skills` | Task-sized planning, debugging, test-first development and review; proportional to the change and subject to owner instructions |
| Figma tools/skills | Exposed in this session; approved guide frame `4:2` reread successfully | Use exact role screens/foundations from [design reference](DESIGN_REFERENCE.md) |
| PostgreSQL guidance | Installed at `C:\Users\prate\.agents\skills\supabase-postgres-best-practices\SKILL.md` | Use for local PostgreSQL design; it does not require adopting the Supabase platform |
| Git/GitHub CLI | Main project folder connected to private GitHub | Branches within the owner's single working folder, reviewed commits and repeatable handoffs |
| Node/npm | Commands reported Node `24.11.1`, npm `11.19.0` | Compatible with the inspected Next.js minimum `20.9`; no runtime replacement proposed |
| Graphify CLI | `graphify --version` reported `0.9.61`; `uv tool list` showed `graphifyy v0.9.61` with `graphify` and `graphify-mcp` | Package is present; project indexing and agent integration are separate |

The named `.agents/skills/graphify/SKILL.md` and `.codex/skills/graphify/SKILL.md` were absent, no Graphify MCP tool is exposed in this chat, and the HIMS repository has no graph integration. These focused checks do not prove that no other global registration exists.

## Graphify: useful later, already installed

[Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) builds navigable code/document relationship graphs. Local AST extraction helps an agent ask which modules depend on something; semantic/document extraction can use the assistant/model backend. It does not replace source reading, tests, role enforcement or owner decisions. [Security model](https://github.com/Graphify-Labs/graphify/blob/v8/SECURITY.md)

**Recommendation:** keep the existing CLI and trial it after the admission/billing modules exist, when relationship questions become repetitive. This documents-only repository currently offers little code structure to graph. Do not add it as a mandatory build/runtime dependency.

Codex/Windows integration is documented, but has not been exercised on this project. The installer edits AGENTS.md and `.codex/hooks.json`; its Codex Desktop hook is intentionally inactive, so installation does not guarantee automatic fresh graphs in Desktop. Review those edits and preserve the hospital/AI/financial boundaries. [Codex skill](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/skill-codex.md), [installer](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/install.py)

The inspected upstream `v8` source identifies `0.9.80`, while the local command reports `0.9.61`; no upgrade was performed. Before any later integration, review/pin a supported version and its changes. Python >=3.10 is required; the installed package is `graphifyy`, not a same-named unrelated `graphify` package. Neo4j, Node, vector databases and a shared HTTP service are not required for its base CLI. [Manifest](https://github.com/Graphify-Labs/graphify/blob/v8/pyproject.toml), [changelog](https://github.com/Graphify-Labs/graphify/blob/v8/CHANGELOG.md)

A useful trial indexes source/schema and synthetic documentation only, excludes credentials/private uploads/patient files/database dumps, records source commit and updates after changes/pulls. Compare several actual dependency questions against `rg` and direct reads. Keep it only if the graph answers correctly and saves work. Start with manual refresh; background Git hooks, live database introspection and cross-project graphs add maintenance/data scope before we need them. [Incremental update guidance](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/skills/codex/references/update.md)

## Framework and agent support to add at the right time

| Repository/tool | Recommendation | Why / cost |
|---|---|---|
| [vercel/next.js](https://github.com/vercel/next.js) | Required application framework; scaffold Task 1 with official `create-next-app` | Use published packages, not a clone/fork of the framework's full source tree. Stable `next` and `create-next-app` were both `16.4.0` in the live npm check; verify security patch and lock at execution. [Installation](https://nextjs.org/docs/app/getting-started/installation) |
| [vercel/next-devtools-mcp](https://github.com/vercel/next-devtools-mcp) | Most useful extra agent connection after the dev app runs | Reads running Next.js errors/routes/logs rather than guessing from source alone. Codex/Windows setup is documented; connecting/configuring an MCP server and verifying its tools is separate from installing npm packages. No connection was added in this planning task. [Next.js MCP guide](https://nextjs.org/docs/app/guides/mcp) |
| Next.js bundled agent guidance | Keep with the installed framework | The current framework supplies version-matched documentation and managed AGENTS instructions. Review its generated child AGENTS file while retaining root project rules; no extra generic Next.js prompt pack is needed initially. [Official agent guide](https://nextjs.org/docs/app/guides/ai-agents) |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Add browser tests at Task 1 | Checks real staff journeys, permissions, print layouts and UI behavior. Browser binaries/test maintenance are the tradeoff; critical flows make this worthwhile. [Official introduction](https://playwright.dev/docs/intro) |

Next.js DevTools is a development tool; run it against the synthetic local development app. Its runtime views can expose app/log context to the coding assistant. Review its telemetry/client configuration and verify access to the intended app, rather than attaching to a real hospital session automatically.

## Proposed product dependencies, not additional agent systems

- **Drizzle + node-postgres:** typed SQL access and reviewed migrations for local PostgreSQL, with a normal bounded pool. Stable npm `drizzle-orm` was `0.45.4`; current docs also show RC examples, which must not be copied as a stable choice accidentally. [Official PostgreSQL guide](https://orm.drizzle.team/docs/get-started-postgresql)
- **Better Auth:** maintained staff password/session handling with Next.js/Drizzle integration and admin-managed users, avoiding a home-grown login system. Public registration and unrelated account/impersonation capabilities stay disabled. [Next.js integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [admin API](https://better-auth.com/docs/plugins/admin)
- **LangGraph JS + PostgreSQL checkpointer:** owner-selected bounded paperwork workflow without another backend language or a paid agent platform. Persistent checkpoints support paused human review across restarts; in-memory state does not. Model/OCR provider remains the owner's later decision. [LangGraph JS repository](https://github.com/langchain-ai/langgraphjs), [checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
- **Zod, Vitest and small barcode/QR utilities:** input validation, focused server tests and correct encoders when needed. Add [React PDF](https://github.com/diegomura/react-pdf) at the document task for actual downloadable PDFs with page numbering. Avoid creating custom encoders, a UI framework replacement or a general agent orchestration platform.

Prisma is a credible database alternative, and Auth.js is a credible authentication alternative; replacing libraries before implementation is inexpensive. Changing ORM/schema tooling or session tables after working migrations/users exist costs migration and retesting. The plan proposes one of each, not parallel stacks. No new product package, agent skill, hook or MCP server was installed by this planning/research task.

## Practical agent workflow

Read root AGENTS -> project context -> the current task and scope section -> relevant Figma/source -> inspect affected code -> make the smallest complete change -> run meaningful checks -> review/commit -> update the task/context. Assign disjoint feature work only when contracts are stable; serialize shared migrations/lockfiles and recheck integration. Use Graphify when a fresh graph answers a real relationship question better than ordinary search.

The working project remains [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient); external repositories provide tools/packages, not a replacement home for our hospital code. The detailed [implementation plan](superpowers/plans/2026-10-09-hims-inpatient.md) records when each tool is needed.
