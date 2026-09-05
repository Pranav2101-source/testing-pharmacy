import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Loose ("cut strip") dispensing, driven through a real browser.
 *
 * The Java IT suite proves the arithmetic and the stock ledger. What only a browser
 * can show is the POS half: that the Strip/Tab toggle appears when a pharmacy has
 * enabled loose selling, that flipping it re-prices the line per piece, and that the
 * bill the cashier saves is the bill the server records — quantity in pieces, one
 * pack broken open, the remainder kept.
 *
 * Seeds its own pharmacy so it runs against any empty database.
 */
const API_BASE_URL = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

test.describe.serial("loose dispensing: enable → cut-strip sale → stock", () => {
  const unique = Date.now();
  const pharmacyName = `Loose Pharmacy ${unique}`;
  const ownerEmail = `loose-${unique}@test.local`;
  const password = "LooseCheck123!";
  const medicineName = `Loose Medicine ${unique}`;

  let medicineId = "";
  let batchId = "";

  test("set up a pharmacy, a 10-per-pack medicine with stock, and enable loose selling", async ({ page, request }) => {
    await page.goto("/register");
    await page.locator("#reg-pharmacy-name").fill(pharmacyName);
    await page.locator("#reg-owner-name").fill("Loose Owner");
    await page.locator("#reg-phone").fill("9876500000");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("#reg-email").fill(ownerEmail);
    await page.locator("#reg-password").fill(password);
    await page.locator("#reg-confirm").fill(password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    const token = await tokenFor(request, ownerEmail, password);
    const auth = { Authorization: `Bearer ${token}` };

    // A strip of 10 tablets at MRP 20 → per-piece MRP 2.00.
    const medRes = await request.post(`${API_BASE_URL}/medicines`, {
      headers: auth,
      data: { name: medicineName, gstRate: 12, hsnCode: "30049099", form: "Tablet",
              unit: "strip", packSize: "10 tablets", unitsPerPack: 10, baseUnit: "TABLET" },
    });
    expect(medRes.ok(), `create medicine failed: ${await medRes.text()}`).toBeTruthy();
    medicineId = (await medRes.json()).data.id;

    const stockRes = await request.post(`${API_BASE_URL}/inventory`, {
      headers: auth,
      data: { medicineId, batchNumber: `LOOSE-${unique}`, quantity: 10,
              purchaseRate: 12, mrp: 20, expiryDate: oneYearFromNow() },
    });
    expect(stockRes.ok(), `add stock failed: ${await stockRes.text()}`).toBeTruthy();
    // POST /inventory returns AddStockResponse{item, merged} — the batch itself is nested
    // under `item`, not the top-level `data`.
    batchId = (await stockRes.json()).data.item.id;

    // Turn cut-strip selling on for this medicine at this pharmacy.
    const looseRes = await request.patch(`${API_BASE_URL}/medicines/${medicineId}/loose-settings`, {
      headers: auth,
      data: { allowLooseSale: true, unitsPerPack: 10 },
    });
    expect(looseRes.ok(), `enable loose failed: ${await looseRes.text()}`).toBeTruthy();
    expect((await looseRes.json()).data.allowLooseSale).toBe(true);
  });

  test("the cashier flips a line to loose, sells 8 tablets, and one pack is broken open", async ({ page, request }) => {
    await loginAs(page, ownerEmail, password);
    await page.goto("/dashboard/billing/new");

    const searchBox = page.locator("[data-billing-search]");
    await searchBox.fill(medicineName);
    const resultRow = page.locator("li").filter({ hasText: medicineName }).first();
    await expect(resultRow).toBeVisible({ timeout: 10_000 });
    await resultRow.click();
    await expect(page.getByText("1 Qty.")).toBeVisible({ timeout: 10_000 });

    // The Strip / Tab segmented toggle on the Qty cell only renders because loose
    // selling is enabled for this medicine. It's a button pair (role="group"), not
    // a native <select> — CartTable.tsx:512-551.
    const unitGroup = page.locator('[role="group"][aria-label*="by strip or"]').first();
    await expect(unitGroup).toBeVisible({ timeout: 10_000 });
    await unitGroup.getByRole("button", { name: "Tab" }).click();

    // Type the tablet count directly — the doctor wrote 8.
    const qtyCell = page.locator('[data-col="qty"]').first();
    await qtyCell.click();
    await qtyCell.press("Control+a");
    await qtyCell.fill("8");
    await qtyCell.blur();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Invoice #/)).toBeVisible({ timeout: 15_000 });

    // ── Verify what was actually stored ──────────────────────────────────
    const token = await tokenFor(request, ownerEmail, password);
    const auth = { Authorization: `Bearer ${token}` };

    const inv = await request.get(`${API_BASE_URL}/inventory?search=${encodeURIComponent(medicineName)}&limit=5`, { headers: auth });
    const batch = (await inv.json()).data.items.find((b: { id: string }) => b.id === batchId);
    expect(batch.quantity, "one pack broken open").toBe(9);
    expect(batch.looseUnits, "10 - 8 pieces left loose").toBe(2);
    expect(batch.medicine.allowLooseSale).toBe(true);
  });

  test("asking for two whole packs' worth as loose is refused over the API", async ({ request }) => {
    const token = await tokenFor(request, ownerEmail, password);
    const res = await request.post(`${API_BASE_URL}/billing`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        paymentMode: "CASH", paymentStatus: "PAID",
        items: [{ inventoryId: batchId, quantity: 20, discount: 0, saleUnit: "LOOSE" }],
      },
    });
    expect(res.status()).toBe(422);
    expect(await res.text()).toContain("full pack");
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

async function tokenFor(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE_URL}/auth/login`, { data: { email, password } });
  const body = await res.json();
  return body.data.tokens?.accessToken ?? body.data.accessToken;
}

function oneYearFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}
