import { requireStaff, staffContext } from "@/server/access";
import { downloadDischargeDocument } from "@/server/documents/commands";
import { apiError } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const staff = await requireStaff(request.headers), doc = await downloadDischargeDocument(staffContext(staff, "final-document-download-http"), (await params).documentId);
    return new Response(new Uint8Array(doc.bytes), { headers: { "Content-Type": "application/pdf", "Content-Length": String(doc.bytes.length), "Content-Disposition": `attachment; filename="${doc.name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (e) { const response = apiError(e); response.headers.set("Cache-Control", "private, no-store"); response.headers.set("X-Content-Type-Options", "nosniff"); return response; }
}
