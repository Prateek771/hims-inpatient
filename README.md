# HIMS — Inpatient Care Workspace

A staff-facing Hospital Information Management System for one hospital, connecting admission, clinical work, live charges, insurance paperwork, human discharge clearances and final discharge documents.

The owner approved the clean, minimal Figma direction on **9 October 2026**. The repository currently holds the confirmed scope and setup documents; application development and a build plan have not started.

Private GitHub repository: [Prateek771/hims-inpatient](https://github.com/Prateek771/hims-inpatient). `main` holds the setup baseline; `codex/hims-development` is the isolated development branch.

## Project references

- [Confirmed scope and owner decisions](docs/PROJECT_SCOPE.md)
- [Approved Figma screens and prototype](docs/DESIGN_REFERENCE.md)
- [Agent working instructions](AGENTS.md)
- [Current project context](docs/agent/project-context.md)
- [Original supplied documents and image](docs/reference/README.md)

## Selected tools

Next.js for frontend and backend; local PostgreSQL initially; LangGraph for human-in-the-loop workflows. Insurer verification remains external, payment-service integration is deferred, and staff record external decisions and receipts.

There are no installation, development or application test commands yet. Add verified commands here when application setup is authorized and implemented.
