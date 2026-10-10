import { Pool, type PoolClient } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
export const CHECKPOINT_SCHEMA="hims_paperwork_checkpoints";
/** Explicit owner-only setup. Library migrations are nontransactional, serialized, and rerunnable. */
export async function setupPaperworkCheckpointer(connectionString:string){
  const pool=new Pool({connectionString,max:2,connectionTimeoutMillis:3000});
  let client:PoolClient|undefined,locked=false;
  try{
    client=await pool.connect();
    const {rows:[i]}=await client.query("select current_database() database,current_user role,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user");
    const app=i.database==="hims_local"&&i.role==="hims_owner",test=(i.database==="hims_test"||(process.env.CI==="true"&&/^hims_test_ci_[a-z0-9]{8,40}$/.test(i.database)))&&i.role==="hims_test_owner";
    if((!app&&!test)||i.rolsuper||i.rolcreatedb||i.rolcreaterole)throw new Error("Checkpointer setup requires the dedicated migration owner");
    const runtime=app?"hims_runtime":"hims_test_runtime";
    await client.query("select pg_advisory_lock(729104212)");locked=true;
    await new PostgresSaver(pool,undefined,{schema:CHECKPOINT_SCHEMA}).setup();
    const versions=(await client.query(`select v from ${CHECKPOINT_SCHEMA}.checkpoint_migrations order by v`)).rows.map(r=>r.v);
    if(JSON.stringify(versions)!=="[0,1,2,3,4]")throw new Error("Unexpected installed checkpointer migration version");
    await client.query(`REVOKE ALL ON SCHEMA ${CHECKPOINT_SCHEMA} FROM PUBLIC,${runtime}; GRANT USAGE ON SCHEMA ${CHECKPOINT_SCHEMA} TO ${runtime}; REVOKE ALL ON ALL TABLES IN SCHEMA ${CHECKPOINT_SCHEMA} FROM PUBLIC,${runtime}; GRANT SELECT ON ${CHECKPOINT_SCHEMA}.checkpoint_migrations TO ${runtime}; GRANT SELECT,INSERT ON ${CHECKPOINT_SCHEMA}.checkpoint_blobs TO ${runtime}; GRANT SELECT,INSERT,UPDATE ON ${CHECKPOINT_SCHEMA}.checkpoints,${CHECKPOINT_SCHEMA}.checkpoint_writes TO ${runtime}`);
  }finally{if(locked&&client)await client.query("select pg_advisory_unlock(729104212)");client?.release();await pool.end();}
}
