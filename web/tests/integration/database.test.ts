import { describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { drizzle } from "drizzle-orm/node-postgres";
import { appendAudit } from "../../src/server/audit";
import * as schema from "../../src/server/schema";

describe("PostgreSQL foundation", () => {
  it("migrates an empty test schema and retains immutable audit/version records", async () => {
    await withTestDatabase(async ({ owner, runtime }) => {
      const tables = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='hims'");
      expect(tables.rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(["audit_events", "hospital_settings", "setting_versions"]));
      await owner.query("INSERT INTO hims.hospital_settings(id,name,timezone) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic hospital','Asia/Kolkata')");
      await runtime.query("INSERT INTO hims.audit_events(actor_type,actor_id,source,request_id,event,entity_type,entity_id,reason) VALUES ('system','room-charge','test','request-1','created','settings','synthetic','fixture')");
      for (const sql of ["UPDATE hims.audit_events SET event='changed'", "DELETE FROM hims.audit_events", "TRUNCATE hims.audit_events", "ALTER TABLE hims.audit_events ADD COLUMN unsafe text"]) {
        await expect(runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
      await expect(runtime.query("INSERT INTO hims.audit_events(actor_type,actor_id,source,request_id,event,entity_type,entity_id,reason) VALUES ('system','staff-signature','test','request-1','created','settings','synthetic','fixture')")).rejects.toMatchObject({ code: "23514" });
      await owner.query("BEGIN");
      await owner.query("INSERT INTO hims.hospital_settings(id,name,timezone) VALUES ('00000000-0000-4000-8000-000000000002','Rolled back hospital','Asia/Kolkata')");
      await expect(owner.query("INSERT INTO hims.setting_versions(hospital_id,kind,version,payload,actor_type,actor_id,reason) VALUES ('00000000-0000-4000-8000-000000000099','tariff',1,'{}','staff','synthetic','fixture')")).rejects.toMatchObject({ code: "23503" });
      await owner.query("ROLLBACK");
      expect((await owner.query("SELECT count(*)::int AS count FROM hims.hospital_settings")).rows[0].count).toBe(1);
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.audit_events")).rows[0].count).toBe(1);
      const database = drizzle(runtime, { schema });
      await expect(database.transaction(async (tx) => {
        await appendAudit(tx, { actor: { type: "staff", staffId: "synthetic-staff" }, source: "integration", requestId: "request-2" }, { event: "created", entityType: "settings", entityId: "synthetic", reason: "transaction rollback fixture" });
        await tx.insert(schema.settingVersions).values({ hospitalId: "00000000-0000-4000-8000-000000000099", kind: "rule", version: 1, payload: {}, actorType: "staff", actorId: "synthetic-staff", reason: "fixture" });
      })).rejects.toThrow();
      expect((await runtime.query("SELECT count(*)::int AS count FROM hims.audit_events")).rows[0].count).toBe(1);
      const recorded = await database.transaction((tx) => appendAudit(tx, { actor: { type: "system", systemId: "room-charge" }, source: "integration", requestId: "request-3" }, { event: "created", entityType: "settings", entityId: "synthetic", reason: "valid system fixture", afterVersion: 1 }));
      expect(recorded.id).toMatch(/^[a-f0-9-]{36}$/);
      for (const sql of ["UPDATE hims.setting_versions SET version=2", "DELETE FROM hims.setting_versions", "CREATE TABLE hims.unsafe(id int)"]) {
        await expect(runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    });
  });
});
