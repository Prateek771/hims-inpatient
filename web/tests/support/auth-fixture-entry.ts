import { db } from "../../src/server/db";
import { eq } from "drizzle-orm";
import { createStaffAuth } from "../../src/server/auth";
import { user } from "../../src/server/schema/auth";
for (const role of ["ADMIN","DOCTOR"] as const) {
 const email=`${role.toLowerCase()}@e2e.fixture.invalid`;
 const [existing]=await db.select().from(user).where(eq(user.email,email));
 if(!existing) await createStaffAuth().api.createUser({body:{name:`Synthetic E2E ${role}`,email,password:"SyntheticE2EOnly123!",role}});
}
process.exit(0);
