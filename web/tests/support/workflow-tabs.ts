import { expect, type Page } from "@playwright/test";

/** Follow the same visible task tab a staff member uses; never reveal hidden DOM directly. */
export async function openWorkflowTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const panel = page.locator(`#${await tab.getAttribute("aria-controls")}`);
  await expect(panel).toBeVisible();
  return panel;
}
