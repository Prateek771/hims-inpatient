# Temporary hospital demo sharing

Owner authorized a public URL on 20 October 2026 so another person can test the fictional hospital while the owner's PC is on. This uses tunnl.gg; Vercel deployment and database migrations remain deferred.

## Access and feedback

- Shared login: the owner shares the current allocated URL directly with invited testers. Read it from owner-local ignored `tmp/tunnel-demo-2026-10-20/tunnel.jsonl` and append `/login`; it is deliberately not advertised in this public repository.
- Ordinary owner preview: <http://localhost:3000/login>.
- Use existing staff accounts. Share credentials privately; do not place them in this document or Git. Prepared cases use the role-name logins described in [fictional hospital testing](../FICTIONAL_HOSPITAL_TESTING.md).
- Both instances use the same local PostgreSQL and protected documents. Tester actions save to that same database and remain after the tunnel stops. Use fictional records and avoid repeating completed payments, refunds or departures.
- Ask the tester to record dashboard, patient/IP, exact button, expected result and observed result. A screenshot helps. Feedback is shared separately; this setup does not add an in-app feedback service.
- Keep Windows awake, internet connected, PostgreSQL, the shared app and tunnel running. Turning off the PC or stopping the tunnel makes the public URL unavailable.

## Start and stop

Run these PowerShell commands from the INS project folder. The local scripts, SSH identity, known-host file, logs and PID files are retained privately under ignored `tmp/tunnel-demo-2026-10-20/`.

Start or reconnect public sharing:

```powershell
& .\tmp\tunnel-demo-2026-10-20\start-sharing.ps1
```

Stop public sharing, retaining ordinary localhost and PostgreSQL:

```powershell
& .\tmp\tunnel-demo-2026-10-20\stop-sharing.ps1
```

Start ordinary localhost if it is stopped, in a terminal kept open:

```powershell
node tmp/run-local-preview.mjs tmp/local-preview-task21-618fdbe
```

The start/stop helpers verify process identities before reusing or stopping them. They do not install tools, set up PostgreSQL, migrate, seed, change accounts or modify `web/.env.local`. They depend on the reviewed copied preview and private local files; they are local operating helpers, not portable deployment tooling.

Free tunnl.gg sessions close after two idle hours or 24 hours maximum. Re-run the start helper after expiry. The dedicated SSH key retains the same allocated URL. Visitors may need to continue through tunnl.gg's browser warning page. Password/IP gates at the tunnel layer require a paid plan; the hospital staff login remains enforced. See [provider documentation](https://tunnl.gg/docs).

## Changes while testing

- Database changes made through the application save immediately; other users refresh to see current results. Avoid concurrent edits to the same patient task.
- This is a production preview of the reviewed build, not an automatic frontend watcher. Source edits require verification, rebuilding and refreshing both copied previews. Until then the existing public preview continues showing the old frontend.
- Current preview: `tmp/local-preview-task21-618fdbe`; BUILD_ID `-gnbRBLWKF0VZ-pNwtbvr`; reviewed source fingerprint `618fdbe3bb1628491c2d5967f91bf5b60459fd1561e91cc8d23c37ea224e9e6a`. After a reviewed UI update, update both launch helpers to its new copied preview and restart.
- Public instance listens only on loopback port 3002; ordinary local instance uses 3000. Only the app is forwarded. PostgreSQL is not published.
- Public auth origin is set only in the sharing process to its allocated HTTPS URL. Ordinary local auth remains localhost. No wildcard origin or authentication bypass was added.
- Previously issued immutable PDFs keep their original verification URLs, including localhost links. Their protected PDF downloads work from the public app; do not rewrite historical PDFs. Newly generated public-instance papers use the temporary public origin, which works only while sharing is active.

## Verification evidence

Live HTTPS checks and screenshots are retained in ignored `tmp/tunnel-demo-2026-10-20/`.

- All six roles (Admission, Admin, Nurse, Billing, Pharmacy and Insurance): actual browser sign-in, Secure/HttpOnly session cookie and dashboard loaded; no page errors. The sixth rapid sign-in initially returned the existing five-per-minute429 limit; waiting for its normal window resolved it without changing controls.
- Admission blank form: Next Server Action reached normal server validation and returned “Check the fields and try again.” Missing identity and bed fail parsing before any patient, admission counter or bed-hold write.
- Admin settings: invalid input returned400; foreign Origin returned403. No settings changed.
- Existing final PDF: authorized Admin download200 and valid PDF bytes; anonymous download401. Normal download audit/session records are expected.
- Application readiness returned200. These verify sharing transport and access controls; they do not replay the full patient cycle or certify real-patient production use.
- Stop/start helpers exercised successfully: tunnel stopped and restarted at the same URL, both local ports remained healthy and ordinary readiness stayed200. The start helper waits for shared readiness and checks tunnel liveness before reporting its link.

Initial sandbox-launched previews listened on loopback but were unreachable from the tunnel. Relaunching these specific preview processes outside the tool sandbox resolved the issue; public and direct-loopback login probes returned200. Provider logs can include canceled Next prefetch requests when a verification browser closes; these are distinct from the checked page/form responses.
