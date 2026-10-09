"use server";
import { requireStaff, staffContext } from "@/server/access";
import { createDischargeDocument, getDischargeDocumentReview } from "@/server/documents/commands";
import { DomainError } from "@/server/contracts";
import type { CareState } from "@/components/care-forms";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function createDocumentAction(input: Awaited<ReturnType<typeof getDischargeDocumentReview>>["input"], _previous: CareState, _form: FormData): Promise<CareState> {
  void _previous; void _form;
  let documentId: string;
  try {
    const staff = await requireStaff(), result = await createDischargeDocument(staffContext(staff, "final-document-created"), input); documentId = result.documentId;
  } catch (e) { if (e instanceof DomainError) return { message: e.message, error: true }; throw e; }
  revalidatePath("/documents"); redirect(`/documents/${documentId}`);
}
