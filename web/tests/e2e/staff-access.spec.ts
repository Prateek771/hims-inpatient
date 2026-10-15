import { expect, test } from "@playwright/test";

test("staff login exposes labeled fields and denies public registration and privileged auth routes", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Staff sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("login-narrow.png"),
    fullPage: true,
  });
  for (const path of [
    "sign-up/email",
    "admin/create-user",
    "admin/impersonate-user",
    "admin/remove-user",
    "update-user",
  ]) {
    const response = await request.post(`/api/auth/${path}`, {
      data: {
        name: "forged",
        email: "forged@example.invalid",
        password: "SyntheticOnly123!",
        role: "ADMIN",
        expectedVersion: 0,
        actorId: "forged",
      },
    });
    expect(response.status()).toBe(403);
  }
});

test("actual login, admin staff creation, settings history and wrong-role direct requests", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/admin/staff");
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email").fill("admin@e2e.fixture.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticE2EOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "Patients & admissions", level: 1 })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Hospital sections" })
    .getByRole("link", { name: "Staff & settings", exact: true })
    .click();
  const create = page
    .getByRole("heading", { name: "Create staff account" })
    .locator("..");
  await create.getByLabel("Full name").fill("Synthetic browser nurse");
  await create
    .getByLabel("Email", { exact: true })
    .fill(`nurse-${Date.now()}@e2e.fixture.invalid`);
  await create.getByLabel("Staff role").selectOption("NURSE");
  await create.getByLabel("Initial password").fill("SyntheticE2EOnly123!");
  await create
    .getByLabel("Reason for creating account")
    .fill("Synthetic browser fixture");
  await create.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toHaveText("Staff account saved.");
  await page.goto("/admin/settings");
  const hospital = page
    .getByRole("heading", { name: "Hospital details" })
    .locator("..");
  await hospital.getByLabel("Hospital name").fill("Synthetic E2E hospital");
  await hospital.getByLabel("Hospital address").fill("Synthetic test address");
  await hospital
    .getByLabel("Reason for change")
    .fill("Synthetic browser settings fixture");
  const savedVersion =
    Number(
      await hospital.locator('input[name="expectedVersion"]').inputValue(),
    ) + 1;
  await hospital.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText(
    "New settings version saved",
  );
  const history = page
    .locator("summary")
    .filter({ hasText: `Hospital details · version ${savedVersion}` });
  await expect(history).toBeVisible();
  await history.click();
  await expect(
    history
      .locator("..")
      .getByText("Reason: Synthetic browser settings fixture"),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("admin-settings-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("admin-settings-narrow.png"),
    fullPage: true,
  });
  const forbidden = await page.request.post("/api/auth/admin/remove-user", {
    data: { userId: "forged" },
  });
  expect(forbidden.status()).toBe(403);
  const state = (await (
    await page.request.get("/api/admin/settings")
  ).json()) as { versions: Array<{ kind: string; version: number }> };
  const expectedVersion = Math.max(
    0,
    ...state.versions.filter((v) => v.kind === "rule").map((v) => v.version),
  );
  const forged = await page.request.post("/api/admin/settings", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      expectedVersion,
      actorId: "forged",
      reason: "forgery",
      value: { type: "alert", basis: "insurer-limit", percent: 80 },
    },
  });
  expect(forged.status()).toBe(400);
  const csrf = await page.request.post("/api/admin/settings", {
    headers: { Origin: "https://untrusted.invalid" },
    data: {
      expectedVersion,
      reason: "csrf",
      value: { type: "alert", basis: "insurer-limit", percent: 80 },
    },
  });
  expect(csrf.status()).toBe(403);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Profile for Synthetic E2E ADMIN" }).click();
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email").fill("doctor@e2e.fixture.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticE2EOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "Retained records", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff & settings", exact: true })).toHaveCount(0);
  const wrong = await page.request.post("/api/admin/settings", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      expectedVersion,
      reason: "wrong role",
      value: { type: "alert", basis: "insurer-limit", percent: 80 },
    },
  });
  expect(wrong.status()).toBe(403);
  await page.goto("/admin/staff");
  await expect(page).toHaveURL(/\/history$/);
  expect((await request.get("/api/admin/staff")).status()).toBe(401);
  let throttled = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const failed = await request.post("/api/auth/sign-in/email", {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: {
        email: "unknown@e2e.fixture.invalid",
        password: "InvalidSyntheticOnly!",
      },
    });
    if (failed.status() === 429) {
      throttled = true;
      break;
    }
    expect(failed.status()).toBe(401);
  }
  expect(throttled).toBe(true);
});
