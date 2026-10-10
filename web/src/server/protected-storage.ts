import { existsSync, lstatSync, realpathSync, mkdirSync, accessSync, constants } from "node:fs";
import { resolve, relative, sep, isAbsolute } from "node:path";
import { DomainError } from "./contracts.ts";

export function projectDirectory() {
  const project = existsSync(resolve(process.cwd(), "web/package.json")) ? process.cwd() : resolve(process.cwd(), "..");
  if (!existsSync(resolve(project, "web/package.json"))) throw new DomainError("PRECONDITION", "Protected storage requires the INS project folder");
  return project;
}
/** Reject existing linked ancestors too; a safe-looking leaf beneath a junction is unsafe. */
export function assertProjectDirectory(directory: string) {
  const project = projectDirectory(), suffix = relative(project, resolve(directory));
  if (!suffix || isAbsolute(suffix) || suffix.startsWith(`..${sep}`) || suffix === ".." || resolve(project, suffix) !== resolve(directory)) throw new DomainError("PRECONDITION", "Protected storage must remain in the project");
  let current = project;
  for (const segment of ["", ...suffix.split(sep)]) {
    current = segment ? resolve(current, segment) : current;
    let stat;
    try { stat = lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DomainError("PRECONDITION", "Protected storage must use regular project directories");
    const actual = relative(realpathSync(project), realpathSync(current));
    if (actual === ".." || actual.startsWith(`..${sep}`)) throw new DomainError("PRECONDITION", "Protected storage must use regular project directories");
  }
  return resolve(directory);
}
export function protectedStorageDirectory(kind: "insurance" | "discharge") {
  let name: string;
  try { name = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").pathname.slice(1)); }
  catch { throw new DomainError("PRECONDITION", "Protected storage requires configured database identity"); }
  const synthetic = /^hims_test(?:_ci_[a-z0-9]{8,40})?$/.test(name);
  if (process.env.HIMS_SYNTHETIC_TEST_RUN !== undefined && (process.env.HIMS_SYNTHETIC_TEST_RUN !== "1" || !synthetic)) throw new DomainError("PRECONDITION", "Synthetic run cannot select ordinary storage");
  const flag = process.env[kind === "insurance" ? "HIMS_INSURANCE_STORAGE" : "HIMS_DOCUMENT_STORAGE"];
  if (synthetic !== (flag === "synthetic") || (flag !== undefined && flag !== "synthetic")) throw new DomainError("PRECONDITION", "Synthetic documents require explicitly isolated synthetic storage; supplied paths are refused");
  const recovery = process.env.HIMS_SYNTHETIC_RECOVERY_ID;
  if (recovery !== undefined && (!synthetic || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(recovery))) throw new DomainError("PRECONDITION", "Recovery storage requires a server-owned synthetic namespace");
  return assertProjectDirectory(resolve(projectDirectory(), recovery !== undefined ? `tmp/recovery/${recovery}/storage/${kind}` : synthetic ? `tmp/${kind === "insurance" ? "insurance" : "document"}-test-storage` : `private-uploads/${kind}`));
}
/** Explicit startup preparation; readiness never creates protected directories. */
export function prepareProtectedStorage() {
  for (const kind of ["insurance", "discharge"] as const) {
    const directory = protectedStorageDirectory(kind);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertProjectDirectory(directory); accessSync(directory, constants.R_OK | constants.W_OK);
  }
}
