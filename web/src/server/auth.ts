import { z } from "zod";
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { db, type Transaction } from "./db";
import * as schema from "./schema/auth";
export const staffRoles = [
  "ADMIN",
  "ADMISSION",
  "DOCTOR",
  "NURSE",
  "PHARMACY",
  "LAB",
  "INSURANCE",
  "BILLING",
] as const;
const ac = createAccessControl({
  user: ["create", "set-role", "set-password"] as const,
});
const roles = Object.fromEntries(
  staffRoles.map((role) => [
    role,
    ac.newRole({
      user: role === "ADMIN" ? ["create", "set-role", "set-password"] : [],
    }),
  ]),
);
export function createStaffAuth(database: typeof db | Transaction = db) {
  return betterAuth({
    appName: "HIMS",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
      schemaName: "hims",
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { cookieCache: { enabled: false }, expiresIn: 60 * 60 * 8 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    plugins: [
      admin({
        ac,
        roles,
        adminRoles: ["ADMIN"],
        defaultRole: "ADMISSION",
        bannedUserMessage:
          "Unable to sign in. Contact your hospital administrator.",
      }),
    ],
  });
}
let instance: ReturnType<typeof createStaffAuth> | undefined;
export function getAuth() {
  return (instance ??= createStaffAuth());
}

export const createStaffInput = z.strictObject({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(staffRoles),
  reason: z.string().trim().min(3).max(500),
});
