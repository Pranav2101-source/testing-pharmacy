import crypto from "node:crypto";
import { chromium } from "playwright";
import { prisma } from "../packages/database/dist/client.js";

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signDevAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    pharmacyId: user.pharmacyId,
    role: user.role,
    email: user.email,
    tokenVersion: user.tokenVersion,
    type: "access",
    iat: now,
    exp: now + 900,
  };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

function summarizeFixedElement(el) {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    className: el.getAttribute("class"),
    text: (el.textContent || "").trim().slice(0, 120),
    position: cs.position,
    inset: `${cs.top} ${cs.right} ${cs.bottom} ${cs.left}`,
    width: cs.width,
    height: cs.height,
    pointerEvents: cs.pointerEvents,
    zIndex: cs.zIndex,
    opacity: cs.opacity,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    html: el.outerHTML.slice(0, 300),
  };
}

async function inspectPage(page) {
  return page.evaluate((summarizerSource) => {
    const summarize = new Function("el", `return (${summarizerSource})(el)`);
    const fixed = [...document.querySelectorAll("*")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          cs.position === "fixed" &&
          rect.width >= innerWidth * 0.95 &&
          rect.height >= innerHeight * 0.95
        );
      })
      .map((el) => summarize(el));
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      bodyStyle: {
        overflow: document.body.style.overflow,
        pointerEvents: document.body.style.pointerEvents,
        position: document.body.style.position,
      },
      htmlStyle: {
        overflow: document.documentElement.style.overflow,
        pointerEvents: document.documentElement.style.pointerEvents,
        position: document.documentElement.style.position,
      },
      failedTextVisible: document.body.innerText.includes("Failed to load tenant"),
      fixed,
      topAtCenter: center ? summarize(center) : null,
      scrollY,
      bodyScrollHeight: document.body.scrollHeight,
      viewportHeight: innerHeight,
    };
  }, summarizeFixedElement.toString());
}

const user = await prisma.user.findFirst({
  where: { role: "PLATFORM_ADMIN", isActive: true },
  select: {
    id: true,
    email: true,
    role: true,
    pharmacyId: true,
    tokenVersion: true,
    pharmacy: { select: { name: true } },
  },
});

if (!user) throw new Error("No active PLATFORM_ADMIN user found");

const token = signDevAccessToken(user);
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const logs = [];
const pageErrors = [];
const requestFailures = [];
const apiResponses = [];

page.on("console", (msg) => {
  logs.push({ type: msg.type(), text: msg.text(), location: msg.location() });
});
page.on("pageerror", (err) => {
  pageErrors.push({ message: err.message, stack: err.stack });
});
page.on("requestfailed", (req) => {
  requestFailures.push({
    url: req.url(),
    method: req.method(),
    failure: req.failure()?.errorText,
  });
});
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/api/v1/platform/tenants")) {
    let body = "";
    try {
      body = await res.text();
    } catch (err) {
      body = `<unreadable: ${err.message}>`;
    }
    apiResponses.push({
      url,
      method: res.request().method(),
      status: res.status(),
      body: body.slice(0, 4000),
    });
  }
});

await page.route("**/api/v1/**", (route) => {
  route.continue({
    headers: {
      ...route.request().headers(),
      authorization: `Bearer ${token}`,
    },
  });
});

await page.addInitScript((currentUser) => {
  localStorage.setItem("checkup_user", JSON.stringify(currentUser));
}, {
  id: user.id,
  name: "Platform Admin",
  email: user.email,
  role: user.role,
  pharmacyId: user.pharmacyId,
  pharmacyName: user.pharmacy.name,
});

await page.goto("http://localhost:3000/dashboard/tenants", {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await page.waitForSelector("text=Tenant Management", { timeout: 20_000 });
await page.waitForSelector("tbody tr", { timeout: 20_000 });

const before = await page.evaluate(() => ({
  url: location.href,
  bodyText: document.body.innerText.slice(0, 1000),
  rows: [...document.querySelectorAll("tbody tr")].length,
  firstRowText: document.querySelector("tbody tr")?.textContent?.trim().slice(0, 300),
  bodyStyle: {
    overflow: document.body.style.overflow,
    pointerEvents: document.body.style.pointerEvents,
    position: document.body.style.position,
  },
  htmlStyle: {
    overflow: document.documentElement.style.overflow,
    pointerEvents: document.documentElement.style.pointerEvents,
    position: document.documentElement.style.position,
  },
}));

await page.locator("tbody tr").first().locator("button").first().click({
  force: true,
  timeout: 10_000,
});

await page.waitForSelector("text=Failed to load tenant", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(1000);
const afterOpen = await inspectPage(page);

await page.mouse.wheel(0, 600);
await page.waitForTimeout(300);
const afterWheelOpen = await page.evaluate(() => ({
  scrollY,
  bodyOverflow: document.body.style.overflow,
}));

await page.mouse.click(40, 300);
await page.waitForTimeout(1000);
const afterClose = await inspectPage(page);

await page.mouse.wheel(0, 600);
await page.waitForTimeout(300);
const afterWheelClose = await page.evaluate(() => ({
  scrollY,
  bodyOverflow: document.body.style.overflow,
}));

await browser.close();
await prisma.$disconnect();

console.log(JSON.stringify({
  before,
  apiResponses,
  logs,
  pageErrors,
  requestFailures,
  afterOpen,
  afterWheelOpen,
  afterClose,
  afterWheelClose,
}, null, 2));
