import { loadLocalEnvironment } from "./migrate.ts";
import { prepareProtectedStorage } from "../src/server/protected-storage.ts";
loadLocalEnvironment();
try { prepareProtectedStorage(); console.log("Prepared server-owned protected storage directories. No records or files were replaced."); }
catch { console.error("Protected storage setup unavailable; existing records and files were preserved."); process.exitCode = 1; }
