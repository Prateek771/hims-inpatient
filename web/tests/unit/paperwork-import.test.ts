import { expect,it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath,pathToFileURL } from "node:url";
import { resolve } from "node:path";
it("checkpointer helper imports without connecting or automatically running migrations",()=>{
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const helper=pathToFileURL(resolve(root,"scripts/paperwork-checkpointer.ts")).href;
  const invalid="postgresql://hims_test_owner:synthetic@127.0.0.1:1/hims_test";
  const result=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",`import {setupPaperworkCheckpointer,CHECKPOINT_SCHEMA} from ${JSON.stringify(helper)}; if(typeof setupPaperworkCheckpointer!=='function'||CHECKPOINT_SCHEMA!=='hims_paperwork_checkpoints')throw Error('Missing contract'); console.log('IMPORT_ONLY');`],{cwd:root,env:{...process.env,DATABASE_URL:invalid,MIGRATION_DATABASE_URL:invalid},encoding:"utf8"});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe("IMPORT_ONLY");
});
