import { assertTestDatabase } from "./test-database-guard.ts";

const loopback = ["localhost", "127.0.0.1", "[::1]"];
const restoreName = /^hims_test_restore_[a-f0-9]{8,32}$/;

/**
 * Restore verification dumps the dedicated synthetic database and loads it into a new, uniquely named scratch
 * database on the same loopback server. It never touches the application database or a hosted target.
 */
export function assertRecoveryTargets(sourceOwnerUrl: string, restoreOwnerUrl: string, appUrl?: string) {
  assertTestDatabase(sourceOwnerUrl, appUrl);
  try {
    const source = new URL(sourceOwnerUrl);
    const restore = new URL(restoreOwnerUrl);
    const sameServer = source.hostname === restore.hostname && (source.port || "3306") === (restore.port || "3306");
    const name = decodeURIComponent(restore.pathname.slice(1));
    if (
      !["mysql:", "mariadb:"].includes(restore.protocol) || restore.search || restore.hash ||
      !loopback.includes(restore.hostname) || !sameServer ||
      !restoreName.test(name) || name === decodeURIComponent(source.pathname.slice(1)) ||
      decodeURIComponent(restore.username) !== decodeURIComponent(source.username)
    ) throw new Error();
    return { source: decodeURIComponent(source.pathname.slice(1)), restore: name };
  } catch {
    // URL errors carry their original credential-bearing input. Never retain it.
    throw new Error("Recovery requires a distinct scratch database on the same loopback server");
  }
}
