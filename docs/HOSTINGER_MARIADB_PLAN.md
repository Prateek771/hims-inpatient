# Hostinger + MariaDB hosting plan (draft, 5 November 2026)

Status: owner asked on 4–5 November 2026 to host the HIMS MVP on the existing Hostinger Business plan with its database service instead of a VPS. This is a **plan and feasibility record**, not an authorization for real patient data (see AGENTS.md). Local PostgreSQL stays untouched and remains the source of truth until a reviewed cutover.

## Verified facts
- **Database is MariaDB 11.8.9, not MySQL.** Verified over TLS (certificate checked) with a throwaway database. Triggers, `SIGNAL`, functions, views, JSON columns, CHECK constraints and `GET_LOCK` all worked. `->>` is not supported (use `JSON_VALUE`). Default isolation is READ-COMMITTED. Binary logging is off. Limits: 3 GB per database, 2000 connections.
- **Account:** Business plan, Node 24 supported by Hostinger Node.js web apps. `saavantus.com` is a different, live Next.js app (Node 22) and `realestate`/`healthcare.saavantus.com` are other sites: never modify them, and never run `replace-environment-variables` on them (it replaces the whole set).
- **Test database** `u406177766_hims_probe` exists (probe tables dropped). Its password is only in the ignored `tmp/hostinger-cli/.probe.env`.
- **CLI:** official Hostinger CLI v4.13.3 in ignored `tmp/hostinger-cli/bin`. It can manage databases, Node env vars, builds, logs, files and cron jobs.

## Hosting constraints (Hostinger docs; items marked UNCONFIRMED were not found)
- Every deploy replaces `hbuilds/` and `public_html/`; **no documented persistent upload folder.** Paths outside them probably survive (UNCONFIRMED).
- **No background workers**, no pm2, no WebSockets. Apps may be stopped when idle. Request timeout 120 s. Cron jobs exist (one command, 255 chars, UTC).
- Hostinger forces `output: "standalone"` and starts the server itself. 3 GB RAM, 2 cores, shared process limit 120.
- A Node app on a subdomain must be its own website. Deploying to a domain already on the plan requires removing that site first, so use a **new** subdomain.
- Private GitHub repos deploy through the Hostinger GitHub App. Env vars are set in hPanel or by CLI. From the app, the database host is `localhost` (the `srv…hstgr.io` host is for external clients; UNCONFIRMED from inside).

## Design changes the port needs besides SQL
1. **Protected files** (`private-uploads/`, `web/src/server/protected-storage.ts`): disk is not safe across deploys and the code locates the project root from `web/package.json`. Store insurance files and discharge PDFs in MariaDB (`LONGBLOB`, hash-checked) or a tested persistent path outside `hbuilds/`.
2. **Billing room-worker:** run as a cron job (or staff-triggered route), not a long-running process.
3. **Standalone layout:** remove project-root lookups that assume `INS/web`.
4. **LangGraph paperwork checkpointer:** custom MariaDB saver or state kept in `paperwork_*` tables.
5. Business rules now in 154 triggers move to MariaDB triggers or transactional app checks; the 7 deferred constraint triggers need app-level enforcement. READ-COMMITTED requires re-checking the "repeatable read" snapshot reads.

## Phases
0. Gates: done for MariaDB/trigger/TLS/Node 24. Still to test live: file persistence outside `hbuilds/`, cron running an app script, DB host from inside the app.
1. Install local MariaDB 11.8 (no Docker, owner's choice) and port the data layer on a new branch.
2. Rewrite tests/CI/recovery for MariaDB. Do not weaken checks.
3. Deploy to a new subdomain with **synthetic data only**; compare row counts/hashes; owner decides on real data later.
