import { boolean, index, mysqlTable, text } from "drizzle-orm/mysql-core";
import { key, utc, utcNow } from "./columns";
export const user = mysqlTable("staff_user", {
  id: key("id").primaryKey(),
  name: text("name").notNull(),
  email: key("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: utc("created_at").notNull().default(utcNow),
  updatedAt: utc("updated_at").notNull().default(utcNow),
  role: key("role", 32).notNull().default("ADMISSION"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: utc("ban_expires"),
});
export const session = mysqlTable(
  "staff_session",
  {
    id: key("id").primaryKey(),
    expiresAt: utc("expires_at").notNull(),
    token: key("token").notNull().unique(),
    createdAt: utc("created_at").notNull().default(utcNow),
    updatedAt: utc("updated_at").notNull().default(utcNow),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("staff_session_user_idx").on(t.userId)],
);
export const account = mysqlTable(
  "staff_account",
  {
    id: key("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: utc("access_token_expires_at"),
    refreshTokenExpiresAt: utc("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: utc("created_at").notNull().default(utcNow),
    updatedAt: utc("updated_at").notNull().default(utcNow),
  },
  (t) => [index("staff_account_user_idx").on(t.userId)],
);
export const verification = mysqlTable(
  "staff_verification",
  {
    id: key("id").primaryKey(),
    identifier: key("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: utc("expires_at").notNull(),
    createdAt: utc("created_at").notNull().default(utcNow),
    updatedAt: utc("updated_at").notNull().default(utcNow),
  },
  (t) => [index("staff_verification_identifier_idx").on(t.identifier)],
);
