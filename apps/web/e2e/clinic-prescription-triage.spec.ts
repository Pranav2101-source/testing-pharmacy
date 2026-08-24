import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";

/**
 * The arrived-clinic-prescription workflow, end to end through a real browser:
 * a clinic pushes a prescription → it appears on the Prescriptions tab → the pharmacist
 * opens it → and gets three decisions: Cancel, Save as Draft, Continue to Billing.
 *
 * <p>Prescriptions here arrive through the REAL machine path — a clinic paired over
 * {@code /integration/pair}, then pushing over {@code /integration/prescriptions} with its
 * issued API key. Faking the arrival by writing a row directly would skip the exact thing
 * that decides which screen opens (a non-null externalTenantId set only by ingest), so the
 * routing under test would never actually be exercised.
 *
 * <p>Each case pushes its OWN prescription. The three decisions are mutually exclusive
 * terminal states — a cancelled prescription cannot then be billed — so a shared row would
 * make every case depend on the others not having run.
 */

const API = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const OWNER_EMAIL = "verify-test-3632@example.com";
const OWNER_PASSWORD = "TestPass1234";
/** Seeded with stock below; the medicine these prescriptions ask for. */
const STOCKED_MEDICINE = { id: "cmqxhjn8j000gvnxhgx5guyoe", name: "Vitamin D3" };

const CLINIC_ID = `e2e-clinic-${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.describe("clinic prescription → triage → decide", () => {
  let token: string;
  let clinic: { apiKey: string; apiSecret: string };
  let context: BrowserContext;
  let page: Page;
  /** Created up front, while a JWT is still guaranteed valid — see beforeAll. */
  let counterRx: { id: string; prescriptionNumber: string };

  /**
   * ONE browser session for the whole file, not one per test.
   *
   * <p>Login is rate-limited to 5 attempts per identity per 15 minutes (AuthController's
   * LOGIN_PER_IDENTITY_LIMIT). A login inside each test meant 7 in a run, so the suite
   * locked its own account out partway through and every later case failed at the login
   * screen for a reason that had nothing to do with what it was testing. A shared context
   * costs two logins total and keeps each failure about its own subject.
   */
  /**
   * ORDER MATTERS: every JWT-authenticated call happens BEFORE the browser logs in.
   *
   * <p>{@code /auth/refresh} rotates the session and bumps tokenVersion, which invalidates
   * every outstanding access token (AuthService — deliberate, it is what makes a stolen token
   * die on the next refresh). The browser refreshes on its own schedule, so a token held from
   * before that point starts 401ing mid-run, and the failure surfaces in whichever test
   * happened to use it next rather than where the cause is.
   *
   * <p>So: API setup first, browser second, and anything needing a JWT later gets a FRESH one
   * at the moment of use (see the cancel case). The clinic push path is immune either way —
   * it authenticates with the paired API key, not a user token.
   */
  test.beforeAll(async ({ browser, request }) => {
    token = await apiLogin(request);
    await ensureStock(request, token);
    clinic = await pairClinic(request, token);
    counterRx = await createCounterPrescription(request, token);

    context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("a clinic-sent prescription opens the TRIAGE view, not the old detail modal", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "Triage Patient");
    await openPrescription(page, rx.prescriptionNumber);

    // The triage view's identity: clinic provenance, and all three decisions present.
    await expect(page.getByText("Sent by clinic")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to Billing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as Draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    // The old record view's giveaway must NOT be what opened.
    await expect(page.getByRole("button", { name: "Cancel Rx" })).toHaveCount(0);
  });

  test("a counter-written prescription still opens the ORIGINAL detail modal", async () => {
    // Triage is for prescriptions that arrived unasked-for. Anything typed at the counter is
    // already known to whoever typed it, and keeps the record view.
    await openPrescription(page, counterRx.prescriptionNumber);

    await expect(page.getByText("Sent by clinic")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel Rx" })).toBeVisible();
  });

  test("an unmatched medicine BLOCKS both money actions, with the reason on screen", async ({ request }) => {
    // An unlinked line has no catalogue product and therefore no batch, so it cannot go in a
    // cart at all. Billing around it would silently drop a medicine the doctor prescribed.
    const rx = await pushFromClinic(request, clinic, "Unmatched Patient", {
      medicineName: `Totally Unknown Drug ${Date.now()}`,
    });
    await openPrescription(page, rx.prescriptionNumber);

    await expect(page.getByText(/still need.* matching to your stock/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to Billing" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save as Draft" })).toBeDisabled();
    // Cancel stays available: refusing a prescription you cannot fill is exactly the case.
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  });

  test("Continue to Billing pre-fills the cart and lands in the normal billing screen", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "Billing Patient");
    await openPrescription(page, rx.prescriptionNumber);
    await page.getByRole("button", { name: "Continue to Billing" }).click();

    await expect(page).toHaveURL(/\/dashboard\/billing\/new/, { timeout: 15_000 });
    // The two things a pharmacist would otherwise have retyped: the medicine (in the cart)
    // and the prescription link (in the Rx field).
    await expect(page.getByText(STOCKED_MEDICINE.name).first()).toBeVisible({ timeout: 10_000 });
    // toHaveValue, not getByText: the Rx number is an <input> value in BillHeader's
    // combobox, and input values are not page text. (Nor an attribute selector — React sets
    // value as a DOM property, so input[value=…] would not match either.)
    await expect(page.getByPlaceholder("Search Rx / patient"))
      .toHaveValue(rx.prescriptionNumber, { timeout: 10_000 });
  });

  test("Save as Draft parks it in Sales → Drafts, and it resumes with the cart intact", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "Draft Patient");
    await openPrescription(page, rx.prescriptionNumber);
    await page.getByRole("button", { name: "Save as Draft" }).click();

    // Wait for the confirmation before navigating. click() resolves as soon as the event
    // fires, while the handler is still resolving each medicine's batch over the network —
    // navigating away there tears the page down mid-save and the draft is silently lost.
    // This also asserts the pharmacist actually gets told where it went.
    await expect(page.getByText(/Saved to Sales/)).toBeVisible({ timeout: 15_000 });

    // It lands in the SAME drafts list bill drafts already use — no second place to look.
    // The Sales screen is routed at /dashboard/billing (SalesPage), not /dashboard/sales.
    await page.goto("/dashboard/billing?tab=drafts");
    await expect(page.getByText("Draft Patient").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Resume" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/billing\/new/, { timeout: 15_000 });
    await expect(page.getByText(STOCKED_MEDICINE.name).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Cancel withdraws the prescription AND queues the clinic notification", async ({ request }) => {
    const rx = await pushFromClinic(request, clinic, "Cancel Patient");
    await openPrescription(page, rx.prescriptionNumber);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue to Billing" })).toHaveCount(0, { timeout: 15_000 });

    // Two halves of one fact: the pharmacy's own record, and the report owed to the clinic
    // that wrote it. A cancellation the clinic never hears about leaves a doctor believing a
    // withdrawn script still stands.
    //
    // A FRESH token: the browser has been refreshing throughout the run, and each refresh
    // invalidates the one taken in beforeAll.
    const after = await getPrescription(request, await apiLogin(request), rx.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelNotify, "cancelling a clinic Rx must queue a callback").not.toBeNull();
    expect(["PENDING", "SENT", "FAILED"]).toContain(after.cancelNotify.status);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
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

async function openPrescription(page: Page, prescriptionNumber: string) {
  await page.goto("/dashboard/prescriptions");
  await page.getByText(prescriptionNumber, { exact: true }).first().click();
}

/** Continue to Billing can only be proven against real stock — an empty shelf only proves the error path. */
async function ensureStock(request: APIRequestContext, token: string) {
  const fefo = await request.get(`${API}/inventory/fefo/${STOCKED_MEDICINE.id}?quantity=30`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (fefo.ok() && (await fefo.json()).data) return;

  await request.post(`${API}/inventory`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      medicineId: STOCKED_MEDICINE.id,
      batchNumber: `E2E-VD3-${Date.now()}`,
      expiryDate: "2027-06-30T00:00:00Z",
      quantity: 500,
      purchaseRate: 80.0,
      mrp: 120.0,
      location: "E2E-RACK",
    },
  });
}

/**
 * Pairs a clinic the way a real one does: the pharmacist generates a code on the
 * Integrations screen, the clinic redeems it and receives its own API credentials.
 */
async function pairClinic(request: APIRequestContext, token: string) {
  const keyRes = await request.post(`${API}/pharmacy/emr-connection/key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(keyRes.ok(), "generate pairing code").toBeTruthy();
  const code = (await keyRes.json()).data.key;

  const pairRes = await request.post(`${API}/integration/pair`, {
    data: {
      code,
      emrClinicId: CLINIC_ID,
      clinicName: "E2E Triage Clinic",
      // Deliberately unreachable: the callback must FAIL without ever affecting the
      // pharmacy-side outcome, which is what the cancel case's assertions rely on.
      emrBaseUrl: "http://127.0.0.1:9/webhook",
      webhookSecret: "e2e-webhook-secret",
    },
  });
  expect(pairRes.ok(), "pair clinic").toBeTruthy();
  const paired = (await pairRes.json()).data;
  return { apiKey: paired.apiKey, apiSecret: paired.apiSecret };
}

/** Pushes a prescription over the machine surface, as the clinic's own server would. */
async function pushFromClinic(
  request: APIRequestContext,
  clinic: { apiKey: string; apiSecret: string },
  patientName: string,
  opts: { medicineName?: string } = {},
) {
  const emrPrescriptionId = `e2e-rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post(`${API}/integration/prescriptions`, {
    headers: { "X-API-KEY": clinic.apiKey, "X-API-SECRET": clinic.apiSecret },
    data: {
      emrClinicId: CLINIC_ID,
      emrPrescriptionId,
      prescribedDate: new Date().toISOString(),
      patient: { emrPatientId: "p1", name: patientName, age: 34, phone: "9876500022", gender: "F" },
      doctor: { emrDoctorId: "d1", name: "Dr Anand Rao", registrationNo: "TN-44321" },
      items: [{
        emrItemId: "i1",
        medicineName: opts.medicineName ?? STOCKED_MEDICINE.name,
        quantity: 30,
        dosage: "1-0-0",
        duration: "30 days",
      }],
    },
  });
  expect(res.ok(), `clinic push for ${patientName}`).toBeTruthy();
  const body = (await res.json()).data;
  return { id: body.prescriptionId, prescriptionNumber: body.prescriptionNumber };
}

async function createCounterPrescription(request: APIRequestContext, token: string) {
  const res = await request.post(`${API}/prescriptions`, {
    headers: { Authorization: `Bearer ${token}` },
    // Letters-only uniqueness: the staff API's @ProfessionalName rejects digits in a name
    // (they belong in the registration-number field), so a Date.now() suffix would 400.
    // The machine ingest surface is deliberately more forgiving — see ClinicIngestService —
    // which is why only this counter-side helper needs it.
    data: {
      doctorName: "Dr Counter",
      patientName: `Counter Patient ${letters()}`,
      items: [{ medicineName: STOCKED_MEDICINE.name, medicineId: STOCKED_MEDICINE.id, quantity: 10 }],
    },
  });
  expect(res.ok(), `create counter prescription (${res.status()}): ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

/** A short unique run of letters — digits are not allowed in patient/doctor names. */
function letters(): string {
  return Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6) || "abcdef";
}

async function getPrescription(request: APIRequestContext, token: string, id: string) {
  const res = await request.get(`${API}/prescriptions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), "read prescription back").toBeTruthy();
  return (await res.json()).data;
}
