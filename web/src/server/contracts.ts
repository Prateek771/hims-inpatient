export type AuditActor =
  | { type: "staff"; staffId: string }
  | { type: "system"; systemId: "room-charge" };

export type Money = bigint;
export type StaffRole = "ADMIN" | "ADMISSION" | "DOCTOR" | "NURSE" | "PHARMACY" | "LAB" | "INSURANCE" | "BILLING";
export type Gate = "DOCTOR" | "PHARMACY" | "NURSING" | "BILLING";
export type ErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "PRECONDITION";
export class DomainError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

// Construct on the server from verified staff access or the internal job, never client input.
export type CommandContext = { actor: AuditActor; source: string; requestId: string };

export function assertHumanActor(ctx: CommandContext) {
  if (ctx.actor.type !== "staff" || !ctx.actor.staffId.trim()) {
    throw new DomainError("FORBIDDEN", "This command requires an authenticated staff actor");
  }
  return ctx.actor;
}
