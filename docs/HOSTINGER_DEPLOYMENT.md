# Hostinger deployment (MariaDB branch)

Status on 7 November 2026: the MariaDB port of the approved MVP runs at <https://healthcare.saavantus.com> against the
Hostinger MariaDB database `u406177766_hims`, loaded with the fictional Lotus Grove demo hospital only. No real patient
data, no Docker, no changes to the local PostgreSQL database or to the other sites on the account.

## What runs where

| Part | Where |
| --- | --- |
| Web app | Hostinger "Node.js Web Apps" site `healthcare.saavantus.com` (Node 24, Next.js 16.4.5 standalone server) |
| Database | Hostinger MariaDB 11.8, reached from the app as `localhost`; from a developer PC over TLS with the PC's IP on the Remote MySQL allow-list |
| Files (insurance papers, discharge PDFs) | `protected_files` table (the Hostinger app disk is replaced on every deploy) |
| Room-charge reconciliation | Hostinger cron job (hourly, minute 7) calling `POST /api/cron/room-charges` with `Authorization: Bearer <HIMS_CRON_SECRET>`; the old long-running worker cannot run there |
| Secrets | Never in Git. Generated values live in the ignored files `tmp/hostinger-cli/hims.env` (database), `tmp/hostinger-cli/app-secrets.env` (session and cron secrets) and `tmp/hostinger-cli/env-vars.json` (the full environment sent to Hostinger) |

## Environment variables of the Hostinger site

`DATABASE_URL`, `MIGRATION_DATABASE_URL` (`mysql://user:password@localhost:3306/database`), `BETTER_AUTH_SECRET`
(32+ characters), `BETTER_AUTH_URL` (`https://healthcare.saavantus.com`), `HIMS_CRON_SECRET`, `NODE_ENV=production`.
`hostinger hosting nodejs replace-environment-variables` replaces the whole set, so always send every variable.

## Why the app is built locally

Hostinger's build host has glibc older than 2.29, so Next's native SWC and Turbopack cannot load there, and its packer
drops every folder named `node_modules`. `scripts/hostinger/package-standalone.sh` therefore builds the standalone server
locally (`HIMS_STANDALONE=1`, see `web/next.config.ts`), copies static files and `public/`, renames each `node_modules` to
`nm_`, and prepends a start-up step to `server.js` that links every `nm_` back to `node_modules` (with a CommonJS
resolver fallback). The upload folder (`tmp/hostinger-deploy`) holds a copy of `web/` sources without `node_modules`,
`.next`, `.env*` or `tmp`, a `package.json` whose `build` script only prints a message, a plain `next.config.mjs`, and the
assembled `.next/standalone`.

```bash
bash scripts/hostinger/package-standalone.sh
tmp/hostinger-cli/bin/hostinger.exe up tmp/hostinger-deploy --domain healthcare.saavantus.com --type nodejs --app-type next --node-version 24 --package-manager npm --build-script build --yes
curl https://healthcare.saavantus.com/api/health/ready
```

Do not point these commands at `saavantus.com` or `realestate.saavantus.com`. The previous "Coming Soon" page of the
subdomain is backed up in `tmp/hostinger-backup/healthcare.saavantus.com/index.html`.

## Verified on the live site (7 November 2026)

- `/api/health/ready` reports `ready` (98 tables, 6 views, 334 integrity triggers, 9 routines, application privileges).
- Admin, Admission, Nurse, Billing and Pharmacy demo accounts sign in; each role's own pages return 200 and other roles'
  pages return 404; admission pages and the discharge workspace render; the cron endpoint answers 401 without or with a
  wrong secret and 200 with the secret.
- Sign-in is rate limited to 5 per minute per client, so scripted sweeps must pause between logins.
- Database migrations are applied to Hostinger before any code that needs them is deployed (0006 was applied first).
- Local verification of the same code: see [MariaDB port status](agent/MARIADB_PORT_STATUS.md) (unit 187/187, integration
  173/174, browser 81/81, backup/restore verified).

## Not yet verified

- Discharge PDF download on the live site (the demo has no finished discharge yet).
- Insurance paperwork (LangGraph) end to end on the live site.
- GitHub Actions on `codex/mariadb-port`.
- Hostinger backup/retention for the database, TLS policy and real hospital data handling remain open owner decisions.
