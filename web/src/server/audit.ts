import "server-only";
import type { CommandContext } from "./contracts";
import type { Transaction } from "./db";
import { auditEvents } from "./schema";
import { insertReturning } from "./sql";

export type AuditInput = {
  event: string; entityType: string; entityId: string; reason: string;
  beforeVersion?: number; afterVersion?: number;
};

export async function appendAudit(tx: Transaction, ctx: CommandContext, input: AuditInput) {
  if (!ctx.source.trim() || !ctx.requestId.trim() || !input.reason.trim()) throw new Error("Audit source, request ID and reason are required");
  const actorId = ctx.actor.type === "staff" ? ctx.actor.staffId : ctx.actor.systemId;
  const [event] = await insertReturning(tx, auditEvents, {
    ...input, actorType: ctx.actor.type, actorId, source: ctx.source, requestId: ctx.requestId,
  });
  return { id: event.id, occurredAt: event.occurredAt };
}
