import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createPaperworkGraph, CHECKPOINT_SCHEMA } from "../../src/server/insurance/paperwork-graph";
import { getPaperworkRun, reviewPaperworkRun } from "../../src/server/insurance/paperwork-commands";
import { downloadCaseDocument } from "../../src/server/insurance/documents";
import { getDischargeDocument, downloadDischargeDocument, verifyDocument } from "../../src/server/documents/commands";
import { getBill } from "../../src/server/billing/commands";
import { getCare } from "../../src/server/clinical/commands";
import type { CommandContext } from "../../src/server/contracts";
let stage = "clinical-and-ledger";
async function verify() {
  const folder = process.env.HIMS_RECOVERY_EVIDENCE_DIRECTORY!;
  const f = JSON.parse(readFileSync(resolve(folder, "journey.json"), "utf8"));
  const ctx = (role: string): CommandContext => ({ actor: { type: "staff", staffId: f.staffIds[role] }, source: "synthetic-restored-verification", requestId: randomUUID() });
  const pdfHashes: Record<string, string> = {};
  for (const e of [f.selfPay, f.insured]) {
    const bill = await getBill(ctx("BILLING"), e.admissionId); assert.equal(bill.netPaise, 318000n); assert.equal(bill.retainedPaise, 318000n); assert.equal(bill.outstandingPaise, 0n);
    const chart = await getCare(ctx("DOCTOR"), e.admissionId); assert(chart.addenda.some(a => a.text === "Whole-journey attributable post-discharge addendum")); assert.equal(chart.transferHistory.length, 1); assert.equal(chart.diagnosticReports.length, 2); assert.equal(chart.administrations.length, 1);
    for (const [documentId, version] of [[e.originalDocumentId, 1], [e.amendedDocumentId, 2]] as const) {
      const doc = await getDischargeDocument(ctx("BILLING"), documentId); assert.equal(doc.version, version);
      const downloaded = await downloadDischargeDocument(ctx("BILLING"), documentId), verified = await verifyDocument(ctx("BILLING"), documentId);
      const hash = createHash("sha256").update(downloaded.bytes).digest("hex"); assert.equal(hash, verified.pdfHash); pdfHashes[documentId] = hash;
      await assert.rejects(downloadDischargeDocument(ctx("DOCTOR"), documentId), { code: "FORBIDDEN" });
    }
  }
  stage = "protected-case-file";
  const file = await downloadCaseDocument(ctx("INSURANCE"), f.recovery.caseId, f.recovery.documentId); assert(file.bytes.toString().includes("Synthetic recovery protected case text"));
  await assert.rejects(downloadCaseDocument(ctx("NURSE"), f.recovery.caseId, f.recovery.documentId), { code: "FORBIDDEN" });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    stage = "paused-graph";
    const graph = createPaperworkGraph(new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA }));
    const paused = await graph.getState({ configurable: { thread_id: f.recovery.runId } }); assert(paused.tasks.some(t => t.interrupts?.length)); assert.equal(paused.values.revision, 1);
    const before = await getPaperworkRun(ctx("INSURANCE"), f.recovery.runId); assert.equal(before.status, "AWAITING_REVIEW"); assert.equal(before.reviews.length, 0);
    const staff = ctx("INSURANCE"), input = { runId: f.recovery.runId, expectedDocumentVersion: 1, expectedProposalRevision: 1, decision: "REQUEST_CHANGES", comment: "Human reviewed original restored quotation; clarify local follow-up", requestId: staff.requestId };
    stage = "human-review-resume";
    const changed = await reviewPaperworkRun(staff, input), retried = await reviewPaperworkRun(staff, input); assert.equal(changed.id, retried.id); assert.equal(retried.reviews.length, 1); assert.equal(retried.proposals.length, 2); assert.equal(retried.status, "AWAITING_REVIEW"); assert.equal(retried.packet, null); assert.equal(retried.followups.length, 0);
    const next = await graph.getState({ configurable: { thread_id: f.recovery.runId } }); assert.equal(next.values.revision, 2); assert(next.tasks.some(t => t.interrupts?.length));
    writeFileSync(resolve(folder, "command-verification.json"), JSON.stringify({ pdfHashes, clinicalJourneys: 2, exactNetPaise: "318000", caseFileHash: createHash("sha256").update(file.bytes).digest("hex"), pausedBefore: 1, pausedAfter: 2, humanReviews: 1, packets: 0, followups: 0, wrongRoleDenied: true }, null, 2), { mode: 0o600 });
  } finally { await pool.end(); }
}
verify().then(() => process.exit(0)).catch(error => { const code = error.code ?? error.cause?.code; console.error(JSON.stringify({ stage, recoveryVerificationError: error.name, code: /^[A-Z0-9_]+$/.test(code ?? "") ? code : "UNAVAILABLE" })); process.exit(1); });
