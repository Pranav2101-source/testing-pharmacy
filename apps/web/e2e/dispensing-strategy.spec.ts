import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * The batch-selection strategy, end to end through a real browser.
 *
 * <p>Before this feature the LIFA/LILA button on the billing bar only changed its own
 * label — batch order was hardcoded FEFO everywhere. Now it is a persisted pharmacy
 * setting the backend dispensing engine reads for every flow. This proves the round
 * trip: flip the setting, and the batch the New Bill picker offers first actually
 * changes; flip it back, and it returns.
 *
 * <p>One medicine, two batches of it seeded via the API — one expiring sooner, one
 * later. Under LILA/FEFO the picker must offer the sooner-expiring batch first; under
 * LIFA, the batch received most recently (the later one, seeded second).
 */

const API = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
const OWNER_EMAIL = "verify-test-3632@example.com";
const OWNER_PASSWORD = "TestPass1234";
const MEDICINE = { id: "cmqxhjn8j000gvnxhgx5guyoe", name: "Vitamin D3" };

const SOON_BATCH = `E2E-STRAT-SOON-${Date.now()}`;
const LATER_BATCH = `E2E-STRAT-LATER-${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.describe("dispensing strategy — LILA/LIFA drives the batch picker", () => {
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    const token = await apiLogin(request);
    await seedTwoBatches(request, token);
    // Always start from the default so the run is repeatable.
    await setStrategy(request, token, "LILA_FEFO");

    const context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page);
  });

  test.afterAll(async ({ request }) => {
    await setStrategy(request, await apiLogin(request), "LILA_FEFO");
  });

  test("LILA/FEFO (default): the picker offers the soonest-expiring batch first", async () => {
    const first = await firstBatchOffered(page);
    expect(first).toContain(SOON_BATCH);
  });

  test("switching to LIFA in Settings flips the picker to the most recently received batch", async () => {
    await page.goto("/dashboard/settings/billing");
    await page.getByRole("button", { name: /^LIFA/ }).click();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    const first = await firstBatchOffered(page);
    expect(first).toContain(LATER_BATCH);
  });

  test("the billing-bar toggle switches it back to LILA/FEFO", async () => {
    await page.goto("/dashboard/billing/new");
    await page.getByRole("button", { name: "LIFA", exact: true }).click();
    await expect(page.getByRole("button", { name: "LILA", exact: true })).toBeVisible({ timeout: 10_000 });

    const first = await firstBatchOffered(page);
    expect(first).toContain(SOON_BATCH);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  expect(res.ok(), "test pharmacy login").toBeTruthy();
  return (await res.json()).data.tokens.accessToken;
}

async function loginAs(page: Page) {
  await page.goto("/login");
  await page.locator("#login-email").fill(OWNER_EMAIL);
  await page.locator("#login-password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function setStrategy(request: APIRequestContext, token: string, strategy: string) {
  const res = await request.put(`${API}/dispensing/strategy`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { strategy },
  });
  expect(res.ok(), `set strategy ${strategy}`).toBeTruthy();
}

async function seedTwoBatches(request: APIRequestContext, token: string) {
  const add = (batchNumber: string, expiryDate: string) =>
    request.post(`${API}/inventory`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { medicineId: MEDICINE.id, batchNumber, expiryDate, quantity: 200, purchaseRate: 80, mrp: 120 },
    });
  // Order matters: the SOON batch is received first, the LATER batch second, so
  // "most recently received" (LIFA) is unambiguously the later-expiry one.
  const a = await add(SOON_BATCH, "2027-03-31T00:00:00Z");
  expect(a.ok(), "seed SOON batch").toBeTruthy();
  const b = await add(LATER_BATCH, "2028-09-30T00:00:00Z");
  expect(b.ok(), "seed LATER batch").toBeTruthy();
}

/** Opens a New Bill, searches the medicine, opens the batch picker, returns the first option's text. */
async function firstBatchOffered(page: Page): Promise<string> {
  await page.goto("/dashboard/billing/new");
  const search = page.locator("[data-billing-search]");
  await search.click();
  await search.fill(MEDICINE.name);
  await page.getByText(MEDICINE.name, { exact: true }).first().click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  return (await options.first().textContent()) ?? "";
}
