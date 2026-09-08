import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, "screenshots");

/**
 * The billing cart's PACK column must show the medicine's real pack size, and a "LOOSE OK"
 * flag must sit BESIDE that label without crushing it. Two bugs, both fixed and guarded here
 * end to end against a real backend + browser:
 *
 *   1. A classified syrup (baseUnit ML, 100 mL/bottle) billed from a prescription showed
 *      "100/strip" — packDisplayLabel hardcoded "/strip", and DispensingPlan.Allocation never
 *      carried the catalogue packSize through to the cart. Now: "100ml".
 *   2. A 15-tablet strip with loose selling on showed a stray "1" — the 80px Pack column let
 *      the "LOOSE OK" badge visually clip "15/strip" down to one character. Now the column is
 *      wide enough and the label element is never clipped (scrollWidth <= clientWidth).
 *
 * Screenshots land in e2e/screenshots/.
 */

const API = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
const STAMP = Date.now();
const OWNER_EMAIL = `e2e-pack-${STAMP}@test.local`;
const OWNER_PASSWORD = "TestPass1234!";
const PHARMACY_NAME = `E2E Pack Column Pharmacy ${STAMP}`;
const CLINIC_ID = `e2e-clinic-pack-${STAMP}`;

const SYRUP = `E2E Grilinctus Syrup ${STAMP}`;   // classified measured: 100 mL / bottle
const TABLET = `E2E Paracetamol 650 ${STAMP}`;   // 15 tablets / strip, loose selling ON

test.describe.configure({ mode: "serial" });

test.describe("billing Pack column — pack size beside a LOOSE OK badge", () => {
  let token: string;
  let clinic: { apiKey: string; apiSecret: string };
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    await post(request, `${API}/auth/register`, {
      data: { pharmacyName: PHARMACY_NAME, ownerName: "Pack Owner", phone: "9876500044", email: OWNER_EMAIL, password: OWNER_PASSWORD },
    }).then(expectOk("register"));

    token = (await post(request, `${API}/auth/login`, { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } })
      .then(expectOk("login")).then((r) => r.json())).data.tokens.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    // Classified measured syrup — real catalogue packSize "100ml".
    const syrupId = (await post(request, `${API}/medicines`, {
      headers: auth,
      data: { name: SYRUP, form: "Syrup", unit: "Bottle", packSize: "100ml", unitsPerPack: 100, baseUnit: "ML", gstRate: 12 },
    }).then(expectOk("create syrup")).then((r) => r.json())).data.id;
    await stock(request, auth, syrupId, "SYR");

    // 15-tablet strip; no catalogue packSize, loose selling ON — the "15/strip" + LOOSE OK case.
    const tabletId = (await post(request, `${API}/medicines`, {
      headers: auth,
      data: { name: TABLET, form: "Tablet", unit: "strip", unitsPerPack: 15, baseUnit: "TABLET", gstRate: 12 },
    }).then(expectOk("create tablet")).then((r) => r.json())).data.id;
    await stock(request, auth, tabletId, "TAB");
    await request.patch(`${API}/medicines/${tabletId}/loose-settings`, {
      headers: { Origin: "http://localhost:3000", ...auth },
      data: { allowLooseSale: true, unitsPerPack: 15, confirmed: true },
    }).then(expectOk("enable loose"));

    clinic = await pairClinic(request, token);

    page = await (await browser.newContext()).newPage();
    await page.goto("/login");
    await page.locator("#login-email").fill(OWNER_EMAIL);
    await page.locator("#login-password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("a prescription's syrup shows '100ml' and its 15-tablet strip shows '15/strip' + LOOSE OK, un-clipped", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic);
    await page.goto("/dashboard/prescriptions");
    await page.getByText(rx.prescriptionNumber, { exact: true }).first().click();

    await page.getByRole("button", { name: "Continue to Billing" }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing\/new/, { timeout: 15_000 });
    await expect(page.getByText(SYRUP).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(TABLET).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, "pack-column-cart.png"), fullPage: true });

    const cells = await page.$$eval("[data-col='pack']", (els) =>
      els.map((cell) => {
        const label = cell.querySelector<HTMLElement>("[data-pack-label]")!;
        return {
          text: cell.textContent?.trim(),
          labelText: label.textContent?.trim(),
          clipped: label.scrollWidth > label.clientWidth + 1,
          hasLooseBadge: [...cell.querySelectorAll("span")].some((s) => s.textContent === "LOOSE OK"),
        };
      }),
    );

    const syrupCell = cells.find((c) => c.labelText === "100ml");
    expect(syrupCell, `syrup Pack cell among ${JSON.stringify(cells)}`).toBeTruthy();
    expect(syrupCell!.hasLooseBadge).toBe(false);

    const tabletCell = cells.find((c) => c.labelText === "15/strip");
    expect(tabletCell, `tablet Pack cell among ${JSON.stringify(cells)}`).toBeTruthy();
    expect(tabletCell!.hasLooseBadge, "LOOSE OK badge beside 15/strip").toBe(true);
    expect(tabletCell!.clipped, "the '15/strip' label must not be visually clipped by the badge").toBe(false);

    // No cart Pack cell should ever read as a bare "1" (the old truncation bug).
    for (const c of cells) expect(c.labelText).not.toBe("1");

    // Qty stays independent: 1 bottle for the syrup, 1 strip for the tablet.
    await expect(page.getByText("bottle").first()).toBeVisible();
    await expect(page.getByText("Strip", { exact: true }).first()).toBeVisible();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function expectOk(label: string) {
  return async (res: Awaited<ReturnType<APIRequestContext["post"]>>) => {
    expect(res.ok(), `${label} (${res.status()}): ${await res.text()}`).toBeTruthy();
    return res;
  };
}

async function post(request: APIRequestContext, url: string, options: Parameters<APIRequestContext["post"]>[1] = {}) {
  return request.post(url, { ...options, headers: { Origin: "http://localhost:3000", ...(options.headers ?? {}) } });
}

async function stock(request: APIRequestContext, auth: Record<string, string>, medicineId: string, tag: string) {
  await post(request, `${API}/inventory`, {
    headers: auth,
    data: {
      medicineId,
      batchNumber: `E2E-${tag}-${STAMP}`,
      expiryDate: "2027-12-31T00:00:00Z",
      quantity: 50,
      purchaseRate: 40.0,
      mrp: 110.0,
      location: "E2E-RACK",
    },
  }).then(expectOk(`stock ${tag}`));
}

async function pairClinic(request: APIRequestContext, token: string) {
  const code = (await post(request, `${API}/pharmacy/emr-connection/key`, { headers: { Authorization: `Bearer ${token}` } })
    .then(expectOk("pairing code")).then((r) => r.json())).data.key;
  const paired = (await post(request, `${API}/integration/pair`, {
    data: { code, emrClinicId: CLINIC_ID, clinicName: "E2E Pack Clinic", emrBaseUrl: "http://127.0.0.1:9/webhook", webhookSecret: "e2e-pack-secret" },
  }).then(expectOk("pair")).then((r) => r.json())).data;
  return { apiKey: paired.apiKey, apiSecret: paired.apiSecret };
}

async function pushFromClinic(request: APIRequestContext, clinic: { apiKey: string; apiSecret: string }) {
  const emrPrescriptionId = `e2e-rx-pack-${STAMP}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await post(request, `${API}/integration/prescriptions`, {
    headers: { "X-API-KEY": clinic.apiKey, "X-API-SECRET": clinic.apiSecret },
    data: {
      emrClinicId: CLINIC_ID,
      emrPrescriptionId,
      prescribedDate: new Date().toISOString(),
      patient: { emrPatientId: "p1", name: "Pack Column Patient", age: 40, phone: "9876500055", gender: "M" },
      doctor: { emrDoctorId: "d1", name: "Dr Test", registrationNo: "TN-99001" },
      items: [
        { emrItemId: "i1", medicineName: SYRUP, quantity: 100, dosage: "5ml-5ml-5ml", duration: "5 days" },
        { emrItemId: "i2", medicineName: TABLET, quantity: 15, dosage: "1-0-0", duration: "5 days" },
      ],
    },
  });
  expect(res.ok(), `clinic push (${res.status()}): ${await res.text()}`).toBeTruthy();
  const body = (await res.json()).data;
  return { id: body.prescriptionId, prescriptionNumber: body.prescriptionNumber };
}
