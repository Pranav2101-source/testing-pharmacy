import { test, expect } from "@playwright/test";

/**
 * The core POS golden path, end-to-end through a real browser: register a new
 * pharmacy, add a medicine to the catalog, receive stock via a GRN, confirm
 * it, then sell it through billing. Each step depends on the previous one's
 * data (the medicine created in step 2 is the one received in step 3 and sold
 * in step 4) — this is deliberately one linked flow, not independent cases,
 * because that is what actually exercises frontend+backend integration rather
 * than either side in isolation.
 */
test.describe.serial("golden path: register → add medicine → receive stock → bill it", () => {
  const unique = Date.now();
  const pharmacyName = `Golden Path Pharmacy ${unique}`;
  const ownerEmail = `e2e-${unique}@test.local`;
  const password = "GoldenPath123!";
  const medicineName = `E2E Test Medicine ${unique}`;
  const batchNumber = `E2E-BATCH-${unique}`;

  test("register a new pharmacy account", async ({ page }) => {
    await page.goto("/register");

    await page.locator("#reg-pharmacy-name").fill(pharmacyName);
    await page.locator("#reg-owner-name").fill("E2E Owner");
    await page.locator("#reg-phone").fill("9876543210");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#reg-email").fill(ownerEmail);
    await page.locator("#reg-password").fill(password);
    await page.locator("#reg-confirm").fill(password);
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test("add a medicine to the catalog", async ({ page }) => {
    // Fresh page context per test, so log in again rather than relying on
    // in-memory state from the previous test (the access token lives only in
    // a JS variable, not localStorage — see api-client.ts / auth.ts).
    await loginAs(page, ownerEmail, password);

    await page.goto("/dashboard/medicines");
    await page.getByRole("button", { name: "Add Medicine" }).click();

    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add Medicine", exact: true }) });
    await form.getByPlaceholder("e.g. Dolo 650").fill(medicineName);
    await form.getByRole("button", { name: "Add Medicine", exact: true }).click();

    await expect(page.locator('div[aria-live="polite"][aria-label="Notifications"]')).toContainText(`${medicineName} added successfully`, { timeout: 5_000 });
  });

  test("receive stock for that medicine via a GRN, then confirm it", async ({ page, request }) => {
    await loginAs(page, ownerEmail, password);

    // Seed a supplier via a direct API call — a fresh pharmacy has none yet,
    // and this spec is about the GRN/confirm flow, not the (separately owned)
    // Distributors tab's own add-supplier form.
    const loginRes = await request.post("http://localhost:8080/api/v1/auth/login", {
      data: { email: ownerEmail, password },
    });
    const { data } = await loginRes.json();
    const token = data.tokens.accessToken;
    await request.post("http://localhost:8080/api/v1/suppliers", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `E2E Supplier ${unique}` },
    });

    await page.goto("/dashboard/purchase");
    // Wait for the page's own content past the lazy-load spinner before
    // interacting — otherwise "New" can resolve to the global nav's "New
    // Bill" button instead (substring name matching), since that renders
    // immediately while this page is still loading.
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "New", exact: true }).click();

    await expect(page.getByText("Gate Inward — New GRN")).toBeVisible();

    // The Purchase page's own list-filter <select>s (All Distributors, All
    // Status) are earlier in the DOM than the modal's — .first() picks up the
    // background filter, not the modal field. Its placeholder option text
    // ("Select supplier…") is unique among all <select>s on the page.
    const supplierSelect = page.locator("select").filter({ hasText: "Select supplier" });
    // The dropdown fetches suppliers on its own schedule, independent of the
    // API call above having already completed — wait for a real option
    // (not just the placeholder) before selecting, rather than racing it.
    await expect(supplierSelect.locator("option")).toHaveCount(2, { timeout: 10_000 });
    await supplierSelect.selectOption({ index: 1 });

    await page.getByPlaceholder("Search medicine name…").fill(medicineName);
    await page.getByText(medicineName, { exact: false }).first().click();

    // The line-item grid uses a real <table>/<tr>/<td> but no explicit
    // <tbody> (React doesn't auto-insert one the way the HTML parser does),
    // so a "tbody tr" locator matches nothing — locate inputs directly
    // instead. Date inputs 0-1 are a background date-RANGE filter (with a
    // "–" between them) behind the modal; 2 is the modal's own Invoice Date;
    // 3 is the row's Expiry.
    await page.getByPlaceholder("Batch").fill(batchNumber);
    await page.locator('input[type="date"]').nth(3).fill(oneYearFromNowIsoDate());

    const numberInputs = page.locator('input[type="number"]');
    await numberInputs.nth(1).fill("10"); // Rcvd
    await numberInputs.nth(3).fill("50"); // Buy Rate
    await numberInputs.nth(4).fill("100"); // MRP

    await page.getByRole("button", { name: "Save GRN" }).click();
    await expect(page.getByText("Gate Inward — New GRN")).not.toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Gate Inward" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Confirm" }).first().click();

    // Assert the actual business outcome (spend recorded, nothing left
    // pending) rather than the toast, which auto-dismisses after ~3.8s and
    // is inherently racy to assert against.
    await expect(page.getByText("No pending gate inwards")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("₹560").first()).toBeVisible();
  });

  test("sell the received stock through billing", async ({ page }) => {
    await loginAs(page, ownerEmail, password);

    await page.goto("/dashboard/billing/new");
    const searchBox = page.locator("[data-billing-search]");
    await searchBox.fill(medicineName);
    const resultRow = page.locator("li").filter({ hasText: medicineName }).first();
    await expect(resultRow).toBeVisible({ timeout: 5_000 });
    await resultRow.click();

    // Confirm the cart actually gained a line, not just that the static
    // "Items" bottom-bar label exists (it's always rendered, even at 0).
    await expect(page.getByText("1 Qty.")).toBeVisible({ timeout: 5_000 });

    // Not exact: true — the button's accessible name includes the "F9"
    // shortcut badge text (e.g. "Save F9"), so an exact match against bare
    // "Save" never resolves. The dropdown's other items ("Save & Print",
    // "Save as Draft", etc.) live in a menu that's only in the DOM once the
    // chevron is opened, so this stays unambiguous while it's closed.
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Invoice #/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Invoice saved successfully")).toBeVisible();
  });
});

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

function oneYearFromNowIsoDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
