import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Where proof screenshots land — repo-root/.local-run-logs/support-e2e-shots/ (gitignored). */
const SHOTS = "../../.local-run-logs/support-e2e-shots";
let shotN = 0;
const shot = (p: Page, name: string) =>
  p.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png`, fullPage: true });

/**
 * Support agent management + round-robin assignment, end to end through a real browser.
 *
 * The platform admin reaches the Agents screen from the nav (it had no nav entry and was
 * URL-only), adds agents through the real modal; auto-assigned tickets spread across them;
 * a ticket is resolved from the detail page; deactivating an agent hands their open work to
 * the other agent; the admin assigns a ticket via the round-robin dropdown item; and a
 * support agent claims a ticket with the "Assign to me" button.
 *
 * PRECONDITIONS (this spec does not bootstrap them — same as the other specs here):
 *   1. The Java API is running; VITE_API_URL / apps/web/.env.local point at it.
 *   2. `pnpm --filter @pharmacy/database db:seed` ran against that API's DB (creates the
 *      PLATFORM_ADMIN below). `DATABASE_URL` must be set for the seed.
 *
 * Notes:
 *  - Support agents are a single platform-wide pool with no tenant scoping and are never
 *    rolled back, so `beforeAll` deactivates every pre-existing active agent to keep
 *    round-robin deterministic; `afterAll` deactivates the two this run created.
 *  - ONE browser login for the whole file: login is rate-limited to 5/identity/15min
 *    (AuthController#LOGIN_PER_IDENTITY_LIMIT). The admin token from the API side is taken
 *    BEFORE the browser logs in and is not reused afterwards — the browser rotates the
 *    session (bumping tokenVersion) on its first background refresh, which would 401 it.
 *    See clinic-prescription-triage.spec.ts for the same lesson.
 */

const API = process.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
/** The origin the app runs on. Sent on every API call so requests carrying the refresh cookie
 *  (any /auth/* POST) pass CookieOriginValidationFilter. Must be in the API's ALLOWED_ORIGINS. */
const WEB_ORIGIN = "http://localhost:3000";

const ADMIN_EMAIL = "admin@checkup.local";
const ADMIN_PASSWORD = "DevAdmin1234!";

const RUN = Date.now();
const AGENT_A = { name: `RR Agent A ${RUN}`, email: `rr-a-${RUN}@test.local`, password: "AgentPass123!" };
const AGENT_B = { name: `RR Agent B ${RUN}`, email: `rr-b-${RUN}@test.local`, password: "AgentPass123!" };

test.describe.configure({ mode: "serial" });

// Module scope so the API helpers below can close over them.
let ownerToken: string;
let categoryId: string;

test.describe("support: agents nav + round-robin assignment", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const reg = await request.post(`${API}/auth/register`, {
      headers: { Origin: WEB_ORIGIN },
      data: {
        pharmacyName: `RR Pharmacy ${RUN}`,
        ownerName: "RR Owner",
        phone: "9876500000",
        email: `rr-owner-${RUN}@test.local`,
        password: "OwnerPass123!",
      },
    });
    expect(reg.ok(), `register: ${reg.status()} ${await reg.text()}`).toBeTruthy();
    ownerToken = (await reg.json()).data.accessToken; // register returns a flat accessToken

    const cats = await request.get(`${API}/support/categories`, authHeader(ownerToken));
    categoryId = (await cats.json()).data[0].id;

    // Deterministic round-robin: only this run's two agents should be active.
    for (const a of (await listAgents(request, adminToken)).filter((x) => x.isActive)) {
      await setAgentActive(request, adminToken, a.id, false);
    }

    // ≥ 1280 so the SupportNav tab bar (hidden below Tailwind's xl breakpoint) is on screen.
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test.afterAll(async ({ request }) => {
    try {
      const token = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      for (const a of await listAgents(request, token)) {
        if (a.user.email === AGENT_A.email || a.user.email === AGENT_B.email) {
          await setAgentActive(request, token, a.id, false);
        }
      }
    } catch { /* best-effort cleanup */ }
    await context?.close();
  });

  test("the Agents tab is in the platform-admin nav and opens the Agents page", async () => {
    await page.goto("/dashboard/platform");

    const agentsTab = page.getByRole("tab", { name: "Agents" });
    await expect(agentsTab).toBeVisible();
    await shot(page, "admin-nav-has-agents-tab");
    await agentsTab.click();

    await expect(page).toHaveURL(/\/dashboard\/support\/agents/);
    await expect(page.getByRole("heading", { name: "Support Agents" })).toBeVisible();
    await shot(page, "agents-page-opened");
  });

  test("a platform admin adds two agents through the modal", async () => {
    await page.goto("/dashboard/support/agents");

    for (const agent of [AGENT_A, AGENT_B]) {
      await page.getByRole("button", { name: "Add Agent", exact: true }).first().click();
      await page.getByPlaceholder("e.g. Rahul Sharma").fill(agent.name);
      await page.getByPlaceholder("agent@checkup.com").fill(agent.email);
      await page.getByPlaceholder("Min. 8 characters").fill(agent.password);
      await page.getByRole("button", { name: "Create Agent" }).click();
      await expect(page.locator('div[aria-live="polite"][aria-label="Notifications"]'))
        .toContainText("Support agent created successfully", { timeout: 5_000 });
      await expect(page.getByText(agent.name)).toBeVisible();
    }
    await shot(page, "two-agents-created");
  });

  test("round-robin spreads auto-assigned tickets across both agents", async ({ request }) => {
    const t1 = await raiseTicket(request, ownerToken, "ROUND_ROBIN");
    const t2 = await raiseTicket(request, ownerToken, "ROUND_ROBIN");

    expect(t1.assignedAgentId, "ticket 1 auto-assigned").toBeTruthy();
    expect(t2.assignedAgentId, "ticket 2 auto-assigned").toBeTruthy();
    expect(t1.assignedAgentId, "the two tickets landed on different agents").not.toEqual(t2.assignedAgentId);

    await page.goto("/dashboard/support");
    await expect(page.getByText(AGENT_A.name).first()).toBeVisible();
    await expect(page.getByText(AGENT_B.name).first()).toBeVisible();
    await shot(page, "round-robin-tickets-split-across-agents");
  });

  test("resolving a ticket from the detail page", async ({ request }) => {
    const ticket = await raiseTicket(request, ownerToken, "ROUND_ROBIN");
    await page.goto(`/dashboard/support/${ticket.id}`);
    await expect(page.getByText(ticket.ticketNumber)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Change ticket status" }).click();
    await page.getByRole("menuitem", { name: "Resolved" }).click();

    await expect(page.locator('div[aria-live="polite"][aria-label="Notifications"]'))
      .toContainText("Status updated", { timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Change ticket status" })).toContainText("Resolved");
    await shot(page, "ticket-resolved");
  });

  test("deactivating an agent moves their open tickets to the other agent", async ({ request }) => {
    // Put an open ticket on agent A — the agent claims it themselves ({strategy:"SELF"}).
    const agentToken = await apiLogin(request, AGENT_A.email, AGENT_A.password);
    const ticket = await raiseTicket(request, ownerToken, "UNASSIGNED");
    const claim = await request.patch(`${API}/support/tickets/${ticket.id}/assign`, {
      ...authHeader(agentToken), data: { strategy: "SELF" },
    });
    expect(claim.ok(), `claim: ${claim.status()} ${await claim.text()}`).toBeTruthy();
    expect((await claim.json()).data.assignedAgent.user.name).toEqual(AGENT_A.name);

    await page.goto("/dashboard/support/agents");
    // Card roots carry `bg-white rounded-2xl`; the grid wrapper doesn't — so this narrows to agent A's card.
    const card = page.locator("div.bg-white.rounded-2xl", { hasText: AGENT_A.name });
    await card.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.locator('div[aria-live="polite"][aria-label="Notifications"]'))
      .toContainText("Agent status updated", { timeout: 5_000 });
    await shot(page, "agent-deactivated");

    const after = await getTicket(request, ownerToken, ticket.id);
    expect(after.assignedAgent?.user.name, "ticket handed to the other agent").toEqual(AGENT_B.name);

    await page.goto(`/dashboard/support/${ticket.id}`);
    await expect(page.getByText(AGENT_B.name).first()).toBeVisible();
    await shot(page, "ticket-reassigned-to-other-agent");
  });

  test("admin assigns a ticket via the round-robin dropdown item", async ({ request }) => {
    const ticket = await raiseTicket(request, ownerToken, "UNASSIGNED");
    await page.goto(`/dashboard/support/${ticket.id}`);
    await expect(page.getByText(ticket.ticketNumber)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Assign ticket" }).click();
    await page.getByRole("menuitem", { name: "Round-robin (auto-assign)" }).click();

    await expect(page.locator('div[aria-live="polite"][aria-label="Notifications"]'))
      .toContainText("Ticket assigned", { timeout: 5_000 });
    await shot(page, "admin-round-robin-dropdown-assigned");

    // AGENT_A was deactivated in the previous test, so round-robin can only pick AGENT_B.
    const after = await getTicket(request, ownerToken, ticket.id);
    expect(after.assignedAgent?.user.name).toEqual(AGENT_B.name);
  });

  test("a support agent claims a ticket with the Assign to me button", async ({ browser, request }) => {
    const ticket = await raiseTicket(request, ownerToken, "UNASSIGNED");

    // A separate browser session, logged in as the support agent (not the admin).
    const agentCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const agentPage = await agentCtx.newPage();
    try {
      await loginAs(agentPage, AGENT_B.email, AGENT_B.password);
      await agentPage.goto(`/dashboard/support/${ticket.id}`);
      await expect(agentPage.getByText(ticket.ticketNumber)).toBeVisible({ timeout: 15_000 });

      await agentPage.getByRole("button", { name: "Assign to me" }).click();
      await expect(agentPage.locator('div[aria-live="polite"][aria-label="Notifications"]'))
        .toContainText("Ticket assigned to you", { timeout: 5_000 });
      await expect(agentPage.getByText("Assigned to you")).toBeVisible();
      await shot(agentPage, "agent-assign-to-me");
    } finally {
      await agentCtx.close();
    }

    const after = await getTicket(request, ownerToken, ticket.id);
    expect(after.assignedAgent?.user.name).toEqual(AGENT_B.name);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

type Agent = { id: string; isActive: boolean; user: { email: string } };
type Ticket = {
  id: string;
  ticketNumber: string;
  assignedAgentId: string | null;
  status: string;
  assignedAgent?: { user: { name: string } } | null;
};

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}`, Origin: WEB_ORIGIN } };
}

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { email, password }, headers: { Origin: WEB_ORIGIN } });
  expect(res.ok(), `login ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.tokens.accessToken;
}

async function loginAs(p: Page, email: string, password: string) {
  await p.goto("/login");
  await p.locator("#login-email").fill(email);
  await p.locator("#login-password").fill(password);
  await p.getByRole("button", { name: "Sign In" }).click();
  await expect(p).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

async function listAgents(request: APIRequestContext, token: string): Promise<Agent[]> {
  const res = await request.get(`${API}/support/agents`, authHeader(token));
  const body = await res.text();
  expect(res.ok(), `list agents: ${res.status()} ${body}`).toBeTruthy();
  return JSON.parse(body).data;
}

async function setAgentActive(request: APIRequestContext, token: string, id: string, isActive: boolean) {
  const res = await request.patch(`${API}/support/agents/${id}`, { ...authHeader(token), data: { isActive } });
  expect(res.ok(), `toggle agent ${id}: ${res.status()}`).toBeTruthy();
}

async function raiseTicket(request: APIRequestContext, ownerToken: string, assignmentType: string): Promise<Ticket> {
  const res = await request.post(`${API}/support/tickets`, {
    ...authHeader(ownerToken),
    data: {
      categoryId,
      assignmentType,
      description: `Round-robin e2e ticket ${Date.now()}-${Math.random()}`,
      mobile: "9876500000",
    },
  });
  expect(res.ok(), `raise ticket: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

async function getTicket(request: APIRequestContext, token: string, id: string): Promise<Ticket> {
  const res = await request.get(`${API}/support/tickets/${id}`, authHeader(token));
  expect(res.ok(), `get ticket ${id}: ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}
