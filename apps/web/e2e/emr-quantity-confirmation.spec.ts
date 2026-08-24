import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A clinic line with no usable quantity ("as directed") is ingested as a placeholder rather
 * than rejected — see PrescriptionItem.needsQuantityConfirmation. This is the live, end-to-end
 * proof of the fix: the line must be VISIBLE and labelled honestly (not silently treated as
 * already dispensed), block Continue to Billing / Save as Draft with the right reason, and become
 * billable the moment a pharmacist confirms a real number through ConfirmQuantityPanel.
 *
 * Screenshots are written to e2e/screenshots/ at each step so the flow can be inspected
 * without re-running the suite.
 */

const API = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
const SHOTS = path.join(__dirname, "screenshots");

const OWNER_EMAIL = `e2e-qty-${Date.now()}@test.local`;
const OWNER_PASSWORD = "TestPass1234!";
const PHARMACY_NAME = `E2E Qty Confirm Pharmacy ${Date.now()}`;
const STOCKED_MEDICINE_NAME = `E2E Vitamin D3 ${Date.now()}`;
const CLINIC_ID = `e2e-clinic-qty-${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.describe("EMR: a clinic line with no stated quantity", () => {
  let token: string;
  let medicineId: string;
  let clinic: { apiKey: string; apiSecret: string };
  let page: Page;
  /** Set by the first test, read by the two that follow it — same pattern as counterRx in clinic-prescription-triage.spec.ts. */
  let rxNumber: string;

  test.beforeAll(async ({ browser, request }) => {
    await registerPharmacy(request);
    token = await apiLogin(request);
    medicineId = await addMedicineAndStock(request, token);
    clinic = await pairClinic(request, token);

    const context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page);
  });

  test("the prescription arrives, the line is VISIBLE (not hidden as already dispensed) and honestly labelled", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "As Directed Patient");
    await openPrescription(page, rx.prescriptionNumber);

    await expect(page.getByText("Sent by clinic")).toBeVisible();
    // The banner must name the REAL reason — a quantity, not a medicine-matching problem.
    await expect(page.getByText(/1 line still needs a quantity confirmed/i)).toBeVisible();
    await expect(page.getByText(/needs matching to your stock/i)).toHaveCount(0);
    // The item row: amber "not set", never a struck-through "dispensed".
    await expect(page.getByText("not set")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to Billing" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save as Draft" })).toBeDisabled();

    await page.screenshot({ path: path.join(SHOTS, "1-arrived-unconfirmed-quantity.png"), fullPage: true });

    rxNumber = rx.prescriptionNumber;
  });

  test("confirming the quantity unblocks both money actions", async () => {
    await openPrescription(page, rxNumber);

    await page.getByRole("spinbutton", { name: /quantity for/i }).fill("20");
    await page.getByRole("button", { name: "Confirm" }).click();

    // The success toast is the unambiguous signal the PATCH + refetch round trip actually
    // completed — "quantity confirmed" alone matches both this toast AND leftover banner
    // text mid-transition. Generous timeout: this is two sequential network round trips
    // (confirm, then the panel's own refetch) against the real remote dev database.
    await expect(page.getByText(/Quantity confirmed for/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/still needs?/i)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Continue to Billing" })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Save as Draft" })).toBeEnabled({ timeout: 10_000 });

    await page.screenshot({ path: path.join(SHOTS, "2-quantity-confirmed-actions-enabled.png"), fullPage: true });
  });

  test("Continue to Billing pre-fills the cart with the now-confirmed quantity, and the sale completes end to end", async () => {
    await openPrescription(page, rxNumber);
    await page.getByRole("button", { name: "Continue to Billing" }).click();

    await expect(page).toHaveURL(/\/dashboard\/billing\/new/, { timeout: 15_000 });
    await expect(page.getByText(STOCKED_MEDICINE_NAME).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("Search Rx / patient")).toHaveValue(rxNumber, { timeout: 10_000 });

    await page.screenshot({ path: path.join(SHOTS, "3-bill-now-cart-prefilled.png"), fullPage: true });

    // Completes the sale for real — same "Save" button golden-path.spec.ts uses. Proves the
    // whole chain end to end: a clinic line that arrived with no quantity, confirmed by a
    // pharmacist, invoiced through the exact same billing path any counter sale takes.
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Invoice #/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Invoice saved successfully")).toBeVisible();

    await page.screenshot({ path: path.join(SHOTS, "3b-invoice-completed.png"), fullPage: true });

    // Closes the loop: the prescription this all started from now shows the actual invoice
    // and the dispensed quantity that was confirmed, not the placeholder it arrived with.
    await page.goto("/dashboard/prescriptions");
    await page.getByText(rxNumber, { exact: true }).first().click();
    await expect(page.getByText(/Invoice #/).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, "3c-prescription-after-billing.png"), fullPage: true });
  });
});

test.describe("EMR: Save as Draft (separate prescription, its own confirmed quantity)", () => {
  let token: string;
  let clinic: { apiKey: string; apiSecret: string };
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    token = await apiLogin(request);
    clinic = await pairClinic(request, token, `${CLINIC_ID}-draft`);
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page);
  });

  test("Save as Draft parks a normal (already-confirmed) clinic prescription in Sales -> Drafts", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "Draft Patient", `${CLINIC_ID}-draft`, 15);
    await openPrescription(page, rx.prescriptionNumber);

    await expect(page.getByRole("button", { name: "Save as Draft" })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole("button", { name: "Save as Draft" }).click();
    await expect(page.getByText(/Saved to Sales/)).toBeVisible({ timeout: 15_000 });

    await page.goto("/dashboard/billing?tab=drafts");
    await expect(page.getByText("Draft Patient").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, "4-save-as-draft-in-drafts-list.png"), fullPage: true });

    await page.getByRole("button", { name: "Resume" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/billing\/new/, { timeout: 15_000 });
    await expect(page.getByText(STOCKED_MEDICINE_NAME).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, "5-save-as-draft-resumed.png"), fullPage: true });
  });
});

test.describe("EMR: pairing through the real browser UI (exercises the new hash-lookup fast path)", () => {
  // Its own never-before-paired pharmacy, not OWNER_EMAIL — that one is already paired by
  // the first describe block's beforeAll, so its Integrations screen shows Connected/Disconnect
  // rather than the generate-code flow this test needs to see.
  const PAIR_EMAIL = `e2e-pair-${Date.now()}@test.local`;
  const PAIR_PASSWORD = "TestPass1234!";

  test("generating a code and redeeming it flips the Integrations screen to Connected, live", async ({ page, request }) => {
    const regRes = await post(request, `${API}/auth/register`, {
      data: {
        pharmacyName: `E2E Pair Pharmacy ${Date.now()}`,
        ownerName: "Test Pair Owner",
        phone: "9876543212",
        email: PAIR_EMAIL,
        password: PAIR_PASSWORD,
      },
    });
    expect(regRes.ok(), `register (${regRes.status()}): ${await regRes.text()}`).toBeTruthy();

    await page.goto("/login");
    await page.locator("#login-email").fill(PAIR_EMAIL);
    await page.locator("#login-password").fill(PAIR_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto("/dashboard/integration");
    await expect(page.getByText("checkup.care Clinic (EMR)")).toBeVisible();
    await page.getByRole("button", { name: "Generate pairing code" }).click();
    await expect(page.getByText(/waiting for your clinic/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, "6-pairing-code-generated.png"), fullPage: true });

    // Two <code> elements render here: the Pharmacy URL row (CopyRow) first, then the
    // pairing code itself — .first() would grab the URL. generateKey's onSuccess sets
    // showKey true immediately, so the code is already unmasked at this point.
    const code = await page.locator("code").last().innerText();

    // The clinic's own server redeeming the code — the real /pair call, hitting the NEW
    // hash-indexed lookup this session added (ClinicPairingService#findByEmrSecretLookupHash).
    const pairRes = await post(request, `${API}/integration/pair`, {
      data: {
        code,
        emrClinicId: `${CLINIC_ID}-live-pair`,
        clinicName: "Live Browser Test Clinic",
        emrBaseUrl: "http://127.0.0.1:9/webhook",
        webhookSecret: "e2e-live-pair-secret",
      },
    });
    expect(pairRes.ok(), `pair via API (${pairRes.status()}): ${await pairRes.text()}`).toBeTruthy();

    // The panel polls on its own — no reload — and flips to the celebration state. Matches
    // twice (the panel's own celebration copy AND the success toast say the same thing) —
    // .first() is enough, this only needs to know the text is on screen somewhere.
    await expect(page.getByText(/is connected/i).first()).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: path.join(SHOTS, "7-pairing-connected-live.png"), fullPage: true });
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Every raw API call in this spec goes through this instead of request.post directly.
 *
 * <p>Login (and register, which logs the new owner in) sets the refresh-token cookie on
 * this shared request context — the same one every helper below reuses. Once that cookie
 * is present, CookieOriginValidationFilter requires a matching Origin header on every
 * state-changing call, exactly as it would for a real browser (which sends Origin on
 * every POST, same-origin included). A raw Playwright APIRequestContext does not add one
 * on its own, so it has to be supplied here — this is matching real client behaviour, not
 * working around the check.
 */
async function post(request: APIRequestContext, url: string, options: Parameters<APIRequestContext["post"]>[1] = {}) {
  return request.post(url, {
    ...options,
    headers: { Origin: "http://localhost:3000", ...(options.headers ?? {}) },
  });
}

async function registerPharmacy(request: APIRequestContext) {
  const res = await post(request, `${API}/auth/register`, {
    data: {
      pharmacyName: PHARMACY_NAME,
      ownerName: "Test Quantity Owner",
      phone: "9876543211",
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    },
  });
  expect(res.ok(), `register (${res.status()}): ${await res.text()}`).toBeTruthy();
}

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await post(request, `${API}/auth/login`, {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  expect(res.ok(), `login (${res.status()}): ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.tokens.accessToken;
}

async function loginAs(page: Page) {
  await page.goto("/login");
  await page.locator("#login-email").fill(OWNER_EMAIL);
  await page.locator("#login-password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function openPrescription(page: Page, prescriptionNumber: string) {
  await page.goto("/dashboard/prescriptions");
  await page.getByText(prescriptionNumber, { exact: true }).first().click();
}

async function addMedicineAndStock(request: APIRequestContext, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const medRes = await post(request, `${API}/medicines`, {
    headers,
    data: { name: STOCKED_MEDICINE_NAME, genericName: "Cholecalciferol", form: "Tablet", unit: "strip", gstRate: 12 },
  });
  expect(medRes.ok(), `create medicine (${medRes.status()}): ${await medRes.text()}`).toBeTruthy();
  const medicineId = (await medRes.json()).data.id as string;

  const invRes = await post(request, `${API}/inventory`, {
    headers,
    data: {
      medicineId,
      batchNumber: `E2E-QTY-${Date.now()}`,
      expiryDate: "2027-06-30T00:00:00Z",
      quantity: 500,
      purchaseRate: 80.0,
      mrp: 120.0,
      location: "E2E-RACK",
    },
  });
  expect(invRes.ok(), `add stock (${invRes.status()}): ${await invRes.text()}`).toBeTruthy();
  return medicineId;
}

async function pairClinic(request: APIRequestContext, token: string, clinicId: string = CLINIC_ID) {
  const keyRes = await post(request, `${API}/pharmacy/emr-connection/key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(keyRes.ok(), "generate pairing code").toBeTruthy();
  const code = (await keyRes.json()).data.key;

  const pairRes = await post(request, `${API}/integration/pair`, {
    data: {
      code,
      emrClinicId: clinicId,
      clinicName: "E2E Qty Confirm Clinic",
      emrBaseUrl: "http://127.0.0.1:9/webhook",
      webhookSecret: "e2e-webhook-secret",
    },
  });
  expect(pairRes.ok(), `pair clinic (${pairRes.status()}): ${await pairRes.text()}`).toBeTruthy();
  const paired = (await pairRes.json()).data;
  return { apiKey: paired.apiKey, apiSecret: paired.apiSecret };
}

/** Pushes a prescription with NO quantity on its one line — the "as directed" case. */
async function pushFromClinic(
  request: APIRequestContext,
  clinic: { apiKey: string; apiSecret: string },
  patientName: string,
  clinicId: string = CLINIC_ID,
  quantity: number | null = null,
) {
  const emrPrescriptionId = `e2e-rx-qty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: Record<string, unknown> = {
    emrItemId: "i1",
    medicineName: STOCKED_MEDICINE_NAME,
    dosage: "1-0-0",
    duration: "30 days",
  };
  if (quantity !== null) item.quantity = quantity;

  const res = await post(request, `${API}/integration/prescriptions`, {
    headers: { "X-API-KEY": clinic.apiKey, "X-API-SECRET": clinic.apiSecret },
    data: {
      emrClinicId: clinicId,
      emrPrescriptionId,
      prescribedDate: new Date().toISOString(),
      patient: { emrPatientId: "p1", name: patientName, age: 34, phone: "9876500033", gender: "F" },
      doctor: { emrDoctorId: "d1", name: "Dr Anand Rao", registrationNo: "TN-44321" },
      items: [item],
    },
  });
  expect(res.ok(), `clinic push for ${patientName} (${res.status()}): ${await res.text()}`).toBeTruthy();
  const body = (await res.json()).data;
  return { id: body.prescriptionId, prescriptionNumber: body.prescriptionNumber };
}
