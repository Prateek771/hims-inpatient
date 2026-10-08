import { db } from "../../src/server/db";
import { eq } from "drizzle-orm";
import { createStaffAuth } from "../../src/server/auth";
import { user } from "../../src/server/schema/auth";
async function prepare() {
  for (const role of ["ADMIN", "DOCTOR", "ADMISSION"] as const) {
    const email = `${role.toLowerCase()}@e2e.fixture.invalid`;
    const [existing] = await db
      .select()
      .from(user)
      .where(eq(user.email, email));
    if (!existing)
      await createStaffAuth().api.createUser({
        body: {
          name: `Synthetic E2E ${role}`,
          email,
          password: "SyntheticE2EOnly123!",
          role,
        },
      });
  }
  const { getAuth } = await import("../../src/server/auth");
  const { saveSetting, listSettings } = await import(
    "../../src/server/settings"
  );
  const { requireStaff, staffContext } = await import(
    "../../src/server/access"
  );
  const { createBed } = await import("../../src/server/admissions/commands");
  const { beds } = await import("../../src/server/admissions/schema");
  const response = await getAuth().api.signInEmail({
    asResponse: true,
    body: {
      email: "admin@e2e.fixture.invalid",
      password: "SyntheticE2EOnly123!",
    },
  });
  if (!response.ok) throw new Error("Synthetic fixture admin login failed");
  const h = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  let state = await listSettings(h);
  if (!state.hospital)
    await saveSetting(h, {
      expectedVersion: 0,
      reason: "Synthetic browser identity",
      value: {
        type: "hospital",
        name: "Synthetic E2E hospital",
        address: "Synthetic address",
        timezone: "Asia/Kolkata",
      },
    });
  state = await listSettings(h);
  if (
    !state.versions.some(
      (v) => v.payload.type === "bed-category" && v.payload.code === "GENERAL",
    )
  ) {
    await saveSetting(h, {
      expectedVersion: Math.max(
        0,
        ...state.versions
          .filter((v) => v.kind === "rule")
          .map((v) => v.version),
      ),
      reason: "Synthetic browser room category",
      value: {
        type: "bed-category",
        code: "GENERAL",
        name: "General",
        active: true,
      },
    });
  }
  const [bed] = await db
    .select()
    .from(beds)
    .where(eq(beds.label, "Synthetic E2E General bed"));
  if (!bed)
    await createBed(
      staffContext(await requireStaff(h), "synthetic-browser-bed"),
      {
        label: "Synthetic E2E General bed",
        category: "GENERAL",
        reason: "Synthetic browser inventory",
      },
    );
}
prepare()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify({
        fixtureError: error.name,
        code: error.code ?? error.cause?.code ?? null,
      }),
    );
    process.exit(1);
  });
