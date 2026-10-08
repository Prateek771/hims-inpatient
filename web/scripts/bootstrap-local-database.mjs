import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Deliberately fixed local targets. Never accepts an arbitrary database to reset.
const targets = [
  { database: 'hims_local', owner: 'hims_owner', runtime: 'hims_runtime' },
  { database: 'hims_test', owner: 'hims_test_owner', runtime: 'hims_test_runtime' },
];
const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
const adminPassword = process.env.HIMS_SETUP_ADMIN_PASSWORD;
delete process.env.HIMS_SETUP_ADMIN_PASSWORD;
const admin = new pg.Client({ host: '127.0.0.1', port: 5432, user: 'postgres',
  database: 'postgres', password: adminPassword, connectionTimeoutMillis: 5000 });
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const passwords = new Map();
const connection = (role, database) =>
  `postgresql://${role}:${passwords.get(role)}@127.0.0.1:5432/${database}`;

try {
  if (!adminPassword) throw new Error('PASSWORD_MISSING');
  if (existsSync(envPath)) throw new Error('ENV_EXISTS');
  await admin.connect();
  const roleNames = targets.flatMap(({ owner, runtime }) => [owner, runtime]);
  const existingRoles = await admin.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [roleNames]);
  const existingDatabases = await admin.query('SELECT datname FROM pg_database WHERE datname = ANY($1::text[])', [targets.map((t) => t.database)]);
  if (existingRoles.rowCount || existingDatabases.rowCount) throw new Error('TARGET_EXISTS');
  for (const role of roleNames) passwords.set(role, randomBytes(32).toString('hex'));
  // Exclusive creation preserves recovery credentials if provisioning is interrupted.
  writeFileSync(envPath, [
    '# Private local HIMS credentials. Never commit or share this file.',
    `DATABASE_URL=${connection(targets[0].runtime, targets[0].database)}`,
    `MIGRATION_DATABASE_URL=${connection(targets[0].owner, targets[0].database)}`,
    `TEST_DATABASE_URL=${connection(targets[1].owner, targets[1].database)}`,
    `TEST_RUNTIME_DATABASE_URL=${connection(targets[1].runtime, targets[1].database)}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  for (const role of roleNames) {
    // Password is locally generated hexadecimal; it never contains SQL syntax.
    await admin.query(`CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.get(role)}'`);
  }
  for (const { database, owner, runtime } of targets) {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} OWNER ${quoteIdentifier(owner)}`);
    await admin.query(`REVOKE ALL ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(owner)}, ${quoteIdentifier(runtime)}`);
    const client = new pg.Client({ connectionString: connection(owner, database), connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(runtime)}`);
    } finally { await client.end(); }
  }
  console.log('Created hims_local and hims_test with separate owner/runtime accounts. Credentials saved only in ignored web/.env.local. Schema migrations are the next step.');
} catch (error) {
  const messages = {
    PASSWORD_MISSING: 'No administrator password was supplied.',
    ENV_EXISTS: 'web/.env.local already exists; nothing was overwritten.',
    TARGET_EXISTS: 'A requested HIMS database or role already exists; nothing was replaced.',
  };
  // Never print driver errors, SQL, connection strings or password-bearing objects.
  console.error(messages[error.message] ?? `Database setup failed (code ${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'UNAVAILABLE'}). Existing data was not reset. If web/.env.local was created, preserve it for recovery.`);
  process.exitCode = error.code === '28P01' ? 2 : 1;
} finally { await admin.end().catch(() => {}); }
