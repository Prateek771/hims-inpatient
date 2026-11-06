import { sql } from "drizzle-orm";
import { customType, datetime, varchar } from "drizzle-orm/mysql-core";

/** Native MariaDB UUID column; values are plain lowercase hyphenated strings in JavaScript. */
export const uuid = customType<{ data: string; driverData: string }>({ dataType: () => "uuid" });

/** `DEFAULT uuid()` replaces PostgreSQL gen_random_uuid(). */
export const uuidDefault = sql`(uuid())`;

/** UTC `DATETIME(6)`; every connection runs `SET time_zone = '+00:00'`, so this is the instant. */
export const utc = (name: string) => datetime(name, { mode: "date", fsp: 6 });

/** `DEFAULT (UTC_TIMESTAMP(6))` replaces now() and clock_timestamp(). */
export const utcNow = sql`(UTC_TIMESTAMP(6))`;

/** Indexed, unique or referenced text must be bounded in MariaDB; this replaces PostgreSQL `text` there. */
export const key = (name: string, length = 255) => varchar(name, { length });
