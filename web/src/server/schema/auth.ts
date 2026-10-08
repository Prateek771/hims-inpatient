import { boolean, index, text, timestamp } from "drizzle-orm/pg-core";
import { hims } from "./core";
const date = (name: string) => timestamp(name, { withTimezone: true });
export const user = hims.table("staff_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: date("created_at").notNull().defaultNow(),
  updatedAt: date("updated_at").notNull().defaultNow(),
  role: text("role").notNull().default("ADMISSION"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: date("ban_expires"),
});
export const session = hims.table(
  "staff_session",
  {
    id: text("id").primaryKey(),
    expiresAt: date("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: date("created_at").notNull().defaultNow(),
    updatedAt: date("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("staff_session_user_idx").on(t.userId)],
);
export const account = hims.table(
  "staff_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: date("access_token_expires_at"),
    refreshTokenExpiresAt: date("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: date("created_at").notNull().defaultNow(),
    updatedAt: date("updated_at").notNull().defaultNow(),
  },
  (t) => [index("staff_account_user_idx").on(t.userId)],
);
export const verification = hims.table(
  "staff_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: date("expires_at").notNull(),
    createdAt: date("created_at").notNull().defaultNow(),
    updatedAt: date("updated_at").notNull().defaultNow(),
  },
  (t) => [index("staff_verification_identifier_idx").on(t.identifier)],
);
