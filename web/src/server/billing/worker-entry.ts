import { postDueRoomCharges } from "./room-worker";
// Explicit CLI entry only. Shared worker modules never import this file.
const watch = process.argv.includes("--watch");
do {
  try {
    await postDueRoomCharges(new Date());
    console.log("Room charges reconciled through the captured cutoff.");
  }
  catch {
    console.error("Room reconciliation failed; committed cursors are preserved. Retry recovers remaining work.");
    if (!watch)
      process.exit(1);
  }
  if (watch)
    await new Promise((resolve) => setTimeout(resolve, 60000));
} while (watch);
process.exit(0);
