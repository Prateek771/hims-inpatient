import { dbError } from "../../src/server/sql";

const errnoOf = (error: unknown) => dbError(error).errno ?? 0;

/** A database rule refused the write: trigger SIGNAL (1644) or CHECK constraint (4025, 3819) or value limits. Replaces PostgreSQL 23514/23P01/P0001/42501. */
export const ruleViolation = (error: unknown) => [1644, 4025, 3819, 1406, 1264].includes(errnoOf(error));
/** Replaces PostgreSQL 23505. */
export const uniqueViolation = (error: unknown) => errnoOf(error) === 1062;
/** Replaces PostgreSQL 23503. */
export const foreignKeyViolation = (error: unknown) => [1451, 1452].includes(errnoOf(error));
/** Replaces PostgreSQL 40001/40P01 (deadlock victim or lock wait timeout). */
export const serializationFailure = (error: unknown) => [1213, 1205, 1020].includes(errnoOf(error));
/** The limited test runtime user lacks DDL privileges (MariaDB 1142 command denied, 1044 access denied). */
export const permissionDenied = (error: unknown) => [1142, 1044, 1143].includes(errnoOf(error));
