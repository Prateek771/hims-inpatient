import "server-only";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth, staffRoles } from "./auth";
import { db } from "./db";
import { user } from "./schema/auth";
import { DomainError, type CommandContext, type StaffRole } from "./contracts";
export type Staff = {
  id: string;
  role: StaffRole;
  name: string;
  email: string;
};
export async function requireStaff(requestHeaders?: Headers): Promise<Staff> {
  const result = await getAuth().api.getSession({
    headers: requestHeaders ?? (await headers()),
    query: { disableCookieCache: true },
  });
  if (!result || result.session.impersonatedBy)
    throw new DomainError("UNAUTHORIZED", "Staff sign in required");
  const [current] = await db
    .select({
      id: user.id,
      role: user.role,
      banned: user.banned,
      name: user.name,
      email: user.email,
    })
    .from(user)
    .where(eq(user.id, result.user.id));
  if (
    !current ||
    current.banned ||
    !staffRoles.includes(current.role as StaffRole)
  )
    throw new DomainError("UNAUTHORIZED", "Staff sign in required");
  return {
    id: current.id,
    role: current.role as StaffRole,
    name: current.name,
    email: current.email,
  };
}
export async function requireAdmin(requestHeaders?: Headers) {
  const staff = await requireStaff(requestHeaders);
  if (staff.role !== "ADMIN")
    throw new DomainError("FORBIDDEN", "Administrator access required");
  return staff;
}
export function staffContext(staff: Staff, source: string): CommandContext {
  return {
    actor: { type: "staff", staffId: staff.id },
    source,
    requestId: crypto.randomUUID(),
  };
}
// These field groups are the maximum future projection, never permission to bypass persisted scope.
export const admissionPermissions = {
  ADMIN: {
    scope: "operational",
    actions: ["overview", "exception", "billing-clearance"],
    fields: ["identity", "bed", "status", "money", "clearance"],
  },
  ADMISSION: {
    scope: "admission-worklist",
    actions: ["intake", "bed-allocation"],
    fields: ["identity", "contact", "bed", "intake", "payment-route"],
  },
  DOCTOR: {
    scope: "assigned-care",
    actions: ["clinical-read", "clinical-write", "doctor-clearance"],
    fields: [
      "identity",
      "bed",
      "clinical",
      "orders",
      "vitals",
      "mar",
      "results",
    ],
  },
  NURSE: {
    scope: "assigned-care",
    actions: ["nursing-read", "nursing-write", "nursing-clearance"],
    fields: ["identity", "bed", "orders", "vitals", "mar", "handover"],
  },
  PHARMACY: {
    scope: "department-orders",
    actions: ["medicine-fulfillment", "pharmacy-clearance"],
    fields: ["identity", "bed", "prescription", "medicine-safety", "issues"],
  },
  LAB: {
    scope: "department-orders",
    actions: ["test-fulfillment"],
    fields: ["identity", "test-order", "sample", "result"],
  },
  INSURANCE: {
    scope: "assigned-case",
    actions: ["paperwork"],
    fields: [
      "identity",
      "policy",
      "payer-decision",
      "bill",
      "required-case-documents",
    ],
  },
  BILLING: {
    scope: "billing-worklist",
    actions: ["money", "billing-clearance"],
    fields: [
      "identity",
      "stay",
      "charges",
      "receipts",
      "payer-liability",
      "clearance",
    ],
  },
} as const;
export async function requireAdmissionAccess(
  ctx: CommandContext,
  admissionId: string,
  action: string,
  requestHeaders?: Headers,
): Promise<Staff> {
  const staff = await requireStaff(requestHeaders);
  if (
    ctx.actor.type !== "staff" ||
    ctx.actor.staffId !== staff.id ||
    !admissionId ||
    !(admissionPermissions[staff.role].actions as readonly string[]).includes(
      action,
    )
  )
    throw new DomainError("FORBIDDEN", "Admission access denied");
  const implemented = {
    ADMIN: ["overview"],
    ADMISSION: ["intake", "bed-allocation"],
    DOCTOR: ["clinical-read"],
  };
  if (
    !(staff.role in implemented) ||
    !(implemented[staff.role as keyof typeof implemented] as string[]).includes(
      action,
    )
  )
    throw new DomainError("FORBIDDEN", "Admission access denied");
  const { getAdmission } = await import("./admissions/commands");
  await getAdmission(ctx, admissionId);
  return staff;
}
