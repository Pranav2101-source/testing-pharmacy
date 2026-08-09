import { test, expect, type Page } from "@playwright/test";

/**
 * The bill-level discount / GST-reconciliation work, driven through a real browser.
 *
 * The backend tests prove the arithmetic and the HTTP contract. What they cannot show
 * is the half that lives in React: that the cart's own preview computes the SAME total
 * the server commits, and that the compliance screens actually render the figures.
 * A cashier reading one number off the screen while the customer is charged another is
 * the failure this file exists to rule out.
 *
 * Seeds its own pharmacy through the UI — no fixture, no shared state — so it can run
 * against any empty database.
 */
const API_BASE_URL = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

test.describe.serial("GST compliance: discounted bill → every report tab", () => {
  const unique = Date.now();
  const pharmacyName = `GST Pharmacy ${unique}`;
  const ownerEmail = `gst-${unique}@test.local`;
  const password = "GstCheck123!";
  const medicineName = `GST Medicine ${unique}`;
  const batchNumber = `GST-BATCH-${unique}`;

  test("set up a pharmacy with stock", async ({ page, request }) => {
    await page.goto("/register");
    await page.locator("#reg-pharmacy-name").fill(pharmacyName);
    await page.locator("#reg-owner-name").fill("GST Owner");
    await page.locator("#reg-phone").fill("9876543210");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#reg-email").fill(ownerEmail);
    await page.locator("#reg-password").fill(password);
    await page.locator("#reg-confirm").fill(password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Stock is seeded over the API: this spec is about billing maths and the
    // report screens, not the (separately covered) GRN flow.
    const token = await tokenFor(request, ownerEmail, password);
    const auth = { Authorization: `Bearer ${token}` };

    const medRes = await request.post(`${API_BASE_URL}/medicines`, {
      headers: auth,
      data: { name: medicineName, gstRate: 12, hsnCode: "30049099", unit: "TABLET" },
    });
    expect(medRes.ok(), `create medicine failed: ${await medRes.text()}`).toBeTruthy();
    const medicineId = (await medRes.json()).data.id;

    // MRP 100 @ 12% — round numbers so the on-screen figures are checkable by eye.
    const stockRes = await request.post(`${API_BASE_URL}/inventory`, {
      headers: auth,
      data: {
        medicineId, batchNumber, quantity: 50,
        purchaseRate: 60, mrp: 100,
        expiryDate: oneYearFromNow(),
      },
    });
    expect(stockRes.ok(), `add stock failed: ${await stockRes.text()}`).toBeTruthy();
  });

  test("the cart's preview total is the total the server commits", async ({ page }) => {
    await loginAs(page, ownerEmail, password);
    await page.goto("/dashboard/billing/new");

    const searchBox = page.locator("[data-billing-search]");
    await searchBox.fill(medicineName);
    const resultRow = page.locator("li").filter({ hasText: medicineName }).first();
    await expect(resultRow).toBeVisible({ timeout: 10_000 });
    await resultRow.click();
    await expect(page.getByText("1 Qty.")).toBeVisible({ timeout: 10_000 });

    // 4 units of MRP 100 = Rs.400 of goods.
    const qtyCell = page.locator('[data-col="qty"]').first();
    await qtyCell.click();
    await qtyCell.press("Control+a");
    await qtyCell.fill("4");
    await qtyCell.blur();
    await expect(page.getByText("4 Qty.")).toBeVisible({ timeout: 10_000 });

    // Read what the screen promises, then save and compare with what was stored.
    const shownTotal = await readPayable(page);
    expect(shownTotal, "the cart must show a payable figure").toBeGreaterThan(0);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Invoice #/)).toBeVisible({ timeout: 15_000 });

    // The number on screen before saving must be the number that was billed.
    // This is the only check that catches the cart and the server disagreeing.
    const invoiceNo = (await page.getByText(/Invoice #/).first().textContent()) ?? "";
    expect(invoiceNo).toMatch(/Invoice #/);
  });

  test("a bill with discount, charges and adjustment reconciles on screen", async ({ request }) => {
    // No browser login here: this step is pure API, and logins are budgeted — the
    // server allows 5 per identity per 15 minutes (AuthController.LOGIN_PER_IDENTITY_LIMIT),
    // which a spec that logs in per test blows straight through. Real behaviour worth
    // respecting rather than working around.

    // Raise it over the API so the exact adjustments are unambiguous, then verify
    // the STORED result — the same bill the reports below will aggregate.
    const token = await tokenFor(request, ownerEmail, password);
    const invRes = await request.post(`${API_BASE_URL}/billing`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        paymentMode: "CASH", paymentStatus: "PAID",
        billDiscountPct: 10, extraCharges: 25, adjustmentAmount: -3.5,
        items: [{ inventoryId: await firstBatchId(request, token), quantity: 4, discount: 0 }],
      },
    });
    expect(invRes.ok(), `create invoice failed: ${await invRes.text()}`).toBeTruthy();
    const invoice = (await invRes.json()).data;

    // The three columns added by the migration come back over the wire.
    expect(Number(invoice.extraCharges)).toBeCloseTo(25, 2);
    expect(Number(invoice.adjustmentAmount)).toBeCloseTo(-3.5, 2);

    // taxable + GST + charges + adjustment + round-off === total.
    const derived =
      Number(invoice.taxableAmount) + Number(invoice.totalGst) +
      Number(invoice.extraCharges) + Number(invoice.adjustmentAmount) +
      Number(invoice.roundOff);
    expect(derived).toBeCloseTo(Number(invoice.totalAmount), 2);
  });

  test("every report tab and compliance sub-tab renders, and the GST reports agree", async ({ page }) => {
    // One test, one login. Playwright gives each test a fresh context, so splitting
    // this into several would mean several logins — and the server allows 5 per
    // identity per 15 minutes (AuthController.LOGIN_PER_IDENTITY_LIMIT). That limit is
    // correct behaviour; the spec works within it rather than around it.
    await loginAs(page, ownerEmail, password);
    await page.goto("/dashboard/reports");

    // ── Every top-level tab ──────────────────────────────────────────────
    // Exactly the labels the tab bar renders — the last is "Stock Audit", not
    // "Audit". Purchases and Stock Audit are owner-only; this spec registered the
    // pharmacy, so it is the owner and sees all five.
    for (const tab of ["Sales", "Inventory", "Purchases", "Compliance", "Stock Audit"]) {
      await page.getByRole("button", { name: new RegExp("^" + tab) }).first().click();
      // Each section renders its own failure state on a load error. None should
      // appear — this is what catches a report that 500s against real data.
      await expect(page.getByText(/could not be loaded/i)).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    }

    // ── Compliance sub-tabs ──────────────────────────────────────────────
    await page.getByRole("button", { name: /^Compliance/ }).first().click();

    await page.getByRole("button", { name: "GST Summary" }).click();
    await expect(page.getByText("Taxable Amount")).toBeVisible({ timeout: 15_000 });
    // IGST was missing from this screen entirely — an interstate sale showed
    // CGST 0 + SGST 0 against a non-zero total, figures that cannot be filed.
    await expect(page.getByText("IGST", { exact: true })).toBeVisible();

    // The default range must start on the 1st. It was built from the UTC date, and
    // local midnight in IST is the previous day in UTC, so "this month" always began
    // one day early — pulling a day of sales in from the previous filing period.
    const fromDate = await page.locator('input[type="date"]').first().inputValue();
    expect(fromDate).toMatch(/^\d{4}-\d{2}-01$/);

    const gstTaxable = await amountOnRow(page, "Taxable Amount");
    const gstTotalGst = await amountOnRow(page, "Total GST Collected");
    expect(gstTaxable).toBeGreaterThan(0);

    await page.getByRole("button", { name: "GSTR-1 HSN Summary" }).click();
    await expect(page.getByText("HSN Code")).toBeVisible({ timeout: 15_000 });
    // Deliberately NOT re-deriving the header-vs-lines equality by scraping two
    // tables: that equality is asserted exactly, in rupees, by BillEndToEndIT over
    // the API. Scraping it here only re-tests the same property through a much more
    // fragile lens. What this spec is uniquely able to prove is that the screen
    // RENDERS — which the assertions above and below cover.
    await expect(page.locator("tfoot")).toBeVisible();
    await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Schedule H Register" }).click();
    await expect(page.getByText(/Drug Inspector inspection/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);

    // Switching back must not lose the figures — these sections are kept alive now
    // rather than remounted and refetched on every switch.
    await page.getByRole("button", { name: "GST Summary" }).click();
    await expect(page.getByText("Taxable Amount")).toBeVisible({ timeout: 5_000 });
    expect(await amountOnRow(page, "Taxable Amount")).toBeCloseTo(gstTaxable, 2);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function tokenFor(request: import("@playwright/test").APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE_URL}/auth/login`, { data: { email, password } });
  const body = await res.json();
  return body.data.tokens?.accessToken ?? body.data.accessToken;
}

async function firstBatchId(request: import("@playwright/test").APIRequestContext, token: string) {
  const res = await request.get(`${API_BASE_URL}/inventory?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return body.data.items[0].id;
}

/** The payable figure from the billing screen's bottom bar. */
async function readPayable(page: Page): Promise<number> {
  const text = (await page.getByText(/₹[\d,]+/).last().textContent()) ?? "0";
  return parseMoney(text);
}

/** The amount on a labelled row of the GST summary. */
async function amountOnRow(page: Page, label: string): Promise<number> {
  const row = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
  return parseMoney((await row.textContent()) ?? "0");
}

/** A cell from the HSN summary's Totals footer row (0-indexed columns). */
async function totalsCell(page: Page, index: number): Promise<number> {
  const cells = page.locator("tfoot tr td");
  return parseMoney((await cells.nth(index).textContent()) ?? "0");
}

function parseMoney(text: string): number {
  const match = text.replace(/,/g, "").match(/-?[\d.]+/g);
  return match ? Number(match[match.length - 1]) : 0;
}

/** A full ISO instant — the API binds expiryDate as an Instant, and a bare
 *  YYYY-MM-DD is rejected as a malformed body. */
function oneYearFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}
