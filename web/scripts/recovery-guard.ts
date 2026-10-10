import { assertTestDatabasePair } from "./test-database-guard.ts";
export function assertRecoveryTargets(sourceOwner: string, sourceRuntime: string, targetOwner: string, targetRuntime: string, appUrl?: string) {
  assertTestDatabasePair(sourceOwner, sourceRuntime, appUrl);
  assertTestDatabasePair(targetOwner, targetRuntime, appUrl);
  function identity(value: string) {
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Recovery requires isolated loopback targets");
    return { host: "loopback", port: url.port || "5432", database: decodeURIComponent(url.pathname.slice(1)), owner: decodeURIComponent(url.username) };
  }
  const source = identity(sourceOwner), target = identity(targetOwner);
  if (source.port === target.port) throw new Error("Recovery source and target must be different clusters");
  return { source, target };
}
