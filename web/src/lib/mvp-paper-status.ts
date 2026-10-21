import type { MvpReview } from "@/server/mvp/workspace";

/** Later receipts do not erase the authority or exact paper delivery retained at exit. */
export function mvpPaperStatus(review: Pick<MvpReview, "departure" | "exceptionalDeparture" | "finance" | "documents" | "deliveries" | "exceptions">) {
  const exited = !!review.departure || !!review.exceptionalDeparture;
  const finalDocuments = review.documents.filter(document => document.kind === "FINAL");
  const financeId = review.departure?.mvpFinanceId ?? review.finance?.id;
  const finalDelivery = review.deliveries.find(delivery => delivery.payload.kind === "FINAL" && delivery.payload.financeId === financeId && !!financeId && finalDocuments.some(document => document.id === delivery.payload.documentId))
    ?? (review.exceptionalDeparture ? review.exceptions?.find(delivery => delivery.action === "DELIVERY" && delivery.sourceId === review.exceptionalDeparture?.authorityId && finalDocuments.some(document => document.id === delivery.payload.documentId)) : undefined);
  return {
    exited,
    financeLabel: review.departure?.mvpFinanceId ? "retained at exit" : review.exceptionalDeparture ? "exception authority retained" : review.finance ? "authorized" : "pending",
    finalPapers: finalDelivery ? "delivered" : exited ? "delivery not recorded" : review.finance ? "authorized" : "pending",
    finalDocumentId: finalDelivery ? String(finalDelivery.payload.documentId) : null,
  };
}
