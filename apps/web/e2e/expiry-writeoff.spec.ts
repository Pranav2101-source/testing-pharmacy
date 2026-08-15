import { test, expect, type Page } from "@playwright/test";

/**
 * The expiry write-off and the GSTR-3B tables it feeds, driven through a real browser.
 *
 * The backend suite proves the arithmetic and the HTTP contract. What it cannot show is
 * that any of this RENDERS: the write-off confirm panel, the 4(B)(1)/4(B)(2) split, the
 * amber exposure note, and the guards that stop a half-filled date range being submitted
 * are all React, and all of them were written without ever being looked at.
 *
 * Seeds its own pharmacy through the UI — no fixture, no shared state — so it runs against
 * any empty database.
 */
const API_BASE_URL = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

test.describe.serial("expired stock → write-off → GSTR-3B 4(B)(1)", () => {
  const unique = Date.now();
  const pharmacyName = `WriteOff Pharmacy ${unique}`;
  const ownerEmail = `writeoff-${unique}@test.local`;
  const password = "WriteOff123!";
  const goodMedicine = `Good Medicine ${unique}`;
  const expiredMedicine = `Expired Tonic ${unique}`;
  const noHsnMedicine = `No HSN Medicine ${unique}`;

  test("seed a pharmacy with live stock, expired stock, and a sale", async ({ page, request }) => {
    await page.goto("/register");
    await page.locator("#reg-pharmacy-name").fill(pharmacyName);
    await page.locator("#reg-owner-name").fill("WriteOff Owner");
    await page.locator("#reg-phone").fill("9876543211");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#reg-email").fill(ownerEmail);
    await page.locator("#reg-password").fill(password);
    await page.locator("#reg-confirm").fill(password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    const token = await tokenFor(request, ownerEmail, password);
    const auth = { Authorization: `Bearer ${token}` };

    // Live stock, with an HSN — this one sells.
    const goodId = await createMedicine(request, auth, goodMedicine, 12, "30049099");
    const goodBatch = await addStock(request, auth, goodId, `GOOD-${unique}`, 50, 60, 100, oneYearFromNow());

    // Expired stock: 20 units at Rs.50 cost, 12% GST → Rs.1000 cost, Rs.120 of blocked credit.
    // Round numbers so every figure on screen is checkable by eye.
    const expiredId = await createMedicine(request, auth, expiredMedicine, 12, "30049099");
    await addStock(request, auth, expiredId, `OLD-${unique}`, 20, 50, 90, tenDaysAgo());

    // A medicine with NO HSN, so the GSTR-1 summary has an UNCLASSIFIED row to flag.
    const noHsnId = await createMedicine(request, auth, noHsnMedicine, 5, null);
    const noHsnBatch = await addStock(request, auth, noHsnId, `NOHSN-${unique}`, 30, 20, 40, oneYearFromNow());

    // A bill carrying extra charges and an adjustment, so the GST summary's new rows appear.
    const invRes = await request.post(`${API_BASE_URL}/billing`, {
      headers: auth,
      data: {
        paymentMode: "CASH", paymentStatus: "PAID",
        extraCharges: 25, adjustmentAmount: -3.5,
        items: [
          { inventoryId: goodBatch, quantity: 4, discount: 0 },
          { inventoryId: noHsnBatch, quantity: 3, discount: 0 },
        ],
      },
    });
    expect(invRes.ok(), `create invoice failed: ${await invRes.text()}`).toBeTruthy();
  });

  test("the compliance screens render the new figures, and the write-off closes the exposure",
    async ({ page }) => {
    // Playwright's default 30s budget covers a whole TEST, and this one is deliberately a
    // single long walkthrough — four compliance sub-tabs, a full page reload, the write-off,
    // then back to GSTR-3B. Splitting it to fit would mean a login per test, and the server
    // allows 5 per identity per 15 minutes (AuthController.LOGIN_PER_IDENTITY_LIMIT). Raising
    // the budget is the honest fix; shortening the walkthrough would test less.
    test.setTimeout(150_000);

    // One login for the whole walkthrough, for the reason above.
    await loginAs(page, ownerEmail, password);
    await page.goto("/dashboard/reports");

    // ── GST summary: the three columns that make it reconcile ────────────
    await page.getByRole("button", { name: /^Compliance/ }).first().click();
    await page.getByRole("button", { name: "GST Summary" }).click();
    await expect(page.getByText("Taxable Amount")).toBeVisible({ timeout: 15_000 });

    // These rows are conditional on being non-zero, and the seeded bill has both.
    await expect(page.getByText("Extra Charges")).toBeVisible();
    await expect(page.getByText("Round Off")).toBeVisible();

    // The identity the screen previously could not satisfy.
    const taxable = await amountOnRow(page, "Taxable Amount");
    const gst = await amountOnRow(page, "Total GST Collected");
    const charges = await amountOnRow(page, "Extra Charges");
    const adjust = await amountOnRow(page, "Adjustments");
    const round = await amountOnRow(page, "Round Off");
    const net = await amountOnRow(page, "Net Invoice Value");
    expect(taxable + gst + charges + adjust + round).toBeCloseTo(net, 2);
    await page.screenshot({ path: "e2e-out/01-gst-summary.png", fullPage: true });

    // ── The date guard ───────────────────────────────────────────────────
    const generate = page.getByRole("button", { name: "Generate" }).first();
    await expect(generate).toBeEnabled();
    await page.locator('input[type="date"]').first().fill("");
    await expect(generate, "an empty date must disable Generate, not silently widen the range")
      .toBeDisabled();
    await page.reload();
    await page.getByRole("button", { name: /^Compliance/ }).first().click();

    // ── GSTR-1 HSN: the UNCLASSIFIED flag ────────────────────────────────
    await page.getByRole("button", { name: "GSTR-1 HSN Summary" }).click();
    // By role, not by text: the amber banner's own copy ("… of sales have no HSN code")
    // also contains "HSN Code", so a plain text match is ambiguous.
    await expect(page.getByRole("columnheader", { name: "HSN Code" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/have no HSN code/)).toBeVisible();
    await expect(page.getByText("UNCLASSIFIED").first()).toBeVisible();
    await page.screenshot({ path: "e2e-out/02-hsn-unclassified.png", fullPage: true });

    // ── GSTR-3B before the write-off ─────────────────────────────────────
    await page.getByRole("button", { name: "GSTR-3B" }).click();
    await expect(page.getByText(/\(A\)\(5\) All other ITC/)).toBeVisible({ timeout: 15_000 });
    // Both halves of 4(B) must exist as separate rows.
    await expect(page.getByText(/\(B\)\(1\) ITC reversed/)).toBeVisible();
    await expect(page.getByText(/\(B\)\(2\) ITC reversed/)).toBeVisible();
    // The exposure: Rs.120 of credit trapped in expired stock, with 4(B)(1) still nil.
    await expect(page.getByText(/of credit is sitting in expired stock/)).toBeVisible();
    // The dashboard scrolls an inner container, which fullPage cannot capture — scroll the
    // ITC block into view so the screenshot actually shows the rows being asserted.
    await page.getByText(/of credit is sitting in expired stock/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e-out/03-gstr3b-before.png" });

    // ── Write it off ─────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^Inventory/ }).first().click();
    const writeOffBtn = page.getByRole("button", { name: /Write off 1 expired/ });
    await expect(writeOffBtn, "an OWNER must be offered the write-off").toBeVisible({ timeout: 15_000 });
    await writeOffBtn.click();

    const confirm = page.getByRole("button", { name: "Write off permanently" });
    await expect(confirm, "the confirm must be inert until a reason is typed").toBeDisabled();
    await page.getByPlaceholder(/Reason \(required\)/).fill("Destroyed as per expiry disposal");
    await expect(confirm).toBeEnabled();
    await page.screenshot({ path: "e2e-out/04-writeoff-confirm.png", fullPage: true });
    await confirm.click();

    // The result names the tax consequence at the moment it is created.
    await expect(page.getByText(/Wrote off 1 batch/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/of input tax credit/)).toBeVisible();

    // Every panel that VALUED that stock must stop counting it. Dead Stock and Stock
    // Valuation load once on mount, so without an explicit refetch they kept showing the
    // destroyed batch at full cost — "₹1,000 cost at risk" for stock that no longer
    // exists, which reads as a write-off that silently failed.
    await expect(page.getByText("No items expiring within 90 days")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(expiredMedicine)).toHaveCount(0);
    await page.screenshot({ path: "e2e-out/05-writeoff-done.png", fullPage: true });

    // ── GSTR-3B after ────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^Compliance/ }).first().click();
    await page.getByRole("button", { name: "GSTR-3B" }).click();
    await page.getByRole("button", { name: "Generate" }).first().click();
    await expect(page.getByText(/\(B\)\(1\) ITC reversed/)).toBeVisible({ timeout: 15_000 });
    // The exposure note is gone: the credit has moved into 4(B)(1).
    await expect(page.getByText(/of credit is sitting in expired stock/)).toHaveCount(0);
    await page.getByText(/\(C\) Net ITC available/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e-out/06-gstr3b-after.png" });

    // Nothing anywhere may have rendered as a failure.
    await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);
    await expect(page.getByText(/could not be built/i)).toHaveCount(0);
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
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

type Req = import("@playwright/test").APIRequestContext;

async function tokenFor(request: Req, email: string, password: string) {
  const res = await request.post(`${API_BASE_URL}/auth/login`, { data: { email, password } });
  const body = await res.json();
  return body.data.tokens?.accessToken ?? body.data.accessToken;
}

async function createMedicine(request: Req, auth: Record<string, string>,
                              name: string, gstRate: number, hsnCode: string | null) {
  const data: Record<string, unknown> = { name, gstRate, unit: "TABLET" };
  if (hsnCode) data.hsnCode = hsnCode;
  const res = await request.post(`${API_BASE_URL}/medicines`, { headers: auth, data });
  expect(res.ok(), `create medicine failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.id;
}

async function addStock(request: Req, auth: Record<string, string>, medicineId: string,
                        batchNumber: string, quantity: number, purchaseRate: number,
                        mrp: number, expiryDate: string) {
  const res = await request.post(`${API_BASE_URL}/inventory`, {
    headers: auth,
    data: { medicineId, batchNumber, quantity, purchaseRate, mrp, expiryDate },
  });
  expect(res.ok(), `add stock failed: ${await res.text()}`).toBeTruthy();
  // AddStockResponse is {item, merged} — the batch id lives on `item`, not at the top level.
  return (await res.json()).data.item.id;
}

/** The amount on a labelled row of the GST summary. */
async function amountOnRow(page: Page, label: string): Promise<number> {
  const row = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
  return parseMoney((await row.textContent()) ?? "0");
}

function parseMoney(text: string): number {
  const match = text.replace(/,/g, "").match(/-?[\d.]+/g);
  return match ? Number(match[match.length - 1]) : 0;
}

function oneYearFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

function tenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 10);
  return d.toISOString();
}
