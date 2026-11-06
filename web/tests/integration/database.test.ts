import { describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { drizzle } from "drizzle-orm/mysql2";
import { appendAudit } from "../../src/server/audit";
import * as schema from "../../src/server/schema";

import { foreignKeyViolation, permissionDenied, ruleViolation } from "../support/errors";
describe("MariaDB foundation", () => {
  it("migrates an empty test schema and retains immutable audit/version records", async () => {
    await withTestDatabase(async ({ owner, runtime }) => {
      const tables = await owner.query("SELECT TABLE_NAME AS tablename FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
      expect(tables.rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(["audit_events", "hospital_settings", "setting_versions"]));
      await owner.query("INSERT INTO hospital_settings(id,name,timezone) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic hospital','Asia/Kolkata')");
      await runtime.query("INSERT INTO audit_events(actor_type,actor_id,source,request_id,event,entity_type,entity_id,reason) VALUES ('system','room-charge','test','request-1','created','settings','synthetic','fixture')");
      // Append-only is enforced by triggers (a single hosting user cannot be limited by privileges); the test runtime user also lacks DDL rights.
      for (const sql of ["UPDATE audit_events SET event='changed'", "DELETE FROM audit_events"]) {
        await expect(runtime.query(sql)).rejects.toSatisfy(ruleViolation);
      }
      for (const sql of ["TRUNCATE audit_events", "ALTER TABLE audit_events ADD COLUMN unsafe text"]) {
        await expect(runtime.query(sql)).rejects.toSatisfy(permissionDenied);
      }
      await expect(runtime.query("INSERT INTO audit_events(actor_type,actor_id,source,request_id,event,entity_type,entity_id,reason) VALUES ('system','staff-signature','test','request-1','created','settings','synthetic','fixture')")).rejects.toSatisfy(ruleViolation);
      await owner.query("BEGIN");
      await owner.query("INSERT INTO hospital_settings(id,name,timezone) VALUES ('00000000-0000-4000-8000-000000000002','Rolled back hospital','Asia/Kolkata')");
      await expect(owner.query("INSERT INTO setting_versions(hospital_id,kind,version,payload,actor_type,actor_id,reason) VALUES ('00000000-0000-4000-8000-000000000099','tariff',1,'{}','staff','synthetic','fixture')")).rejects.toSatisfy(foreignKeyViolation);
      await owner.query("ROLLBACK");
      expect((await owner.query("SELECT count(*) AS count FROM hospital_settings")).rows[0].count).toBe(1);
      expect((await runtime.query("SELECT count(*) AS count FROM audit_events")).rows[0].count).toBe(1);
      const database = drizzle(runtime.pool, { schema, mode: "default" });
      await expect(database.transaction(async (tx) => {
        await appendAudit(tx, { actor: { type: "staff", staffId: "synthetic-staff" }, source: "integration", requestId: "request-2" }, { event: "created", entityType: "settings", entityId: "synthetic", reason: "transaction rollback fixture" });
        await tx.insert(schema.settingVersions).values({ hospitalId: "00000000-0000-4000-8000-000000000099", kind: "rule", version: 1, payload: {}, actorType: "staff", actorId: "synthetic-staff", reason: "fixture" });
      })).rejects.toThrow();
      expect((await runtime.query("SELECT count(*) AS count FROM audit_events")).rows[0].count).toBe(1);
      const recorded = await database.transaction((tx) => appendAudit(tx, { actor: { type: "system", systemId: "room-charge" }, source: "integration", requestId: "request-3" }, { event: "created", entityType: "settings", entityId: "synthetic", reason: "valid system fixture", afterVersion: 1 }));
      expect(recorded.id).toMatch(/^[a-f0-9-]{36}$/);
      await owner.query("INSERT INTO setting_versions(hospital_id,kind,version,payload,actor_type,actor_id,reason) VALUES ('00000000-0000-4000-8000-000000000001','tariff',1,'{}','staff','synthetic','fixture')");
      for (const sql of ["UPDATE setting_versions SET version=2", "DELETE FROM setting_versions"]) {
        await expect(runtime.query(sql)).rejects.toSatisfy(ruleViolation);
      }
      await expect(runtime.query("CREATE TABLE unsafe(id int)")).rejects.toSatisfy(permissionDenied);
    });
  });
});
