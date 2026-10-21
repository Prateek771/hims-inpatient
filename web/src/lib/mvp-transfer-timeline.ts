/** Read-only display of authoritative physical bounds, using current bed labels. */
export function mvpTransferTimeline<Stay extends { id: string; bedId: string; startedAt: Date; endedAt: Date | null }, Transfer extends { newStayId: string }>(
  stays: readonly Stay[],
  beds: readonly { id: string; label: string; category: string }[],
  transfers: readonly Transfer[],
) {
  const labels = new Map(beds.map(bed => [bed.id, bed]));
  const arrivals = new Map(transfers.map(transfer => [transfer.newStayId, transfer]));
  return [...stays].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id)).map(stay => ({
    ...stay,
    bedLabel: labels.get(stay.bedId)?.label ?? "Bed label unavailable",
    bedCategory: labels.get(stay.bedId)?.category ?? "Category unavailable",
    transfer: arrivals.get(stay.id) ?? null,
  }));
}
