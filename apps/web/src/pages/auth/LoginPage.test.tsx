import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import LoginPage from "./LoginPage";
import { api } from "@/lib/api-client";

/**
 * The one behaviour here a typecheck can't catch: where a successful login sends
 * the user. It has to honour ?next= (so a session that lapsed mid-task returns to
 * that task) WITHOUT becoming an open redirect — `next` is attacker-controllable
 * (it rides in on a URL), so anything that isn't an in-app /dashboard path must be
 * ignored in favour of the role's home.
 */

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function mockLoginAs(role: string) {
  (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: {
      data: {
        tokens: { accessToken: "test-token" },
        user: { id: "u1", name: "Test", email: "t@test.local", role, pharmacyId: "p1", pharmacyName: "P" },
      },
    },
  });
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname + loc.search}</div>;
}

async function renderLoginAndSubmit(initialEntry: string, role = "SUPPORT_AGENT") {
  mockLoginAs(role);
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText("Email address"), "agent@checkup.local");
  await userEvent.type(screen.getByLabelText("Password"), "DevAdmin1234!");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage — post-login destination", () => {
  it("returns the user to ?next= when it is an in-app dashboard path", async () => {
    await renderLoginAndSubmit("/login?next=%2Fdashboard%2Fsupport%2Fagents");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/support/agents"), { timeout: 2000 });
  });

  it("preserves a query string on the next path", async () => {
    await renderLoginAndSubmit("/login?next=%2Fdashboard%2Finventory%3Ftab%3Daudit");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/inventory?tab=audit"), { timeout: 2000 });
  });

  it("ignores a protocol-relative next and uses the role home instead", async () => {
    await renderLoginAndSubmit("/login?next=%2F%2Fevil.com", "SUPPORT_AGENT");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/support"), { timeout: 2000 });
    expect(screen.getByTestId("path")).not.toHaveTextContent("evil.com");
  });

  it("ignores an absolute-URL next", async () => {
    await renderLoginAndSubmit("/login?next=https%3A%2F%2Fevil.com", "PLATFORM_ADMIN");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/platform"), { timeout: 2000 });
  });

  it("falls back to the role home when there is no next", async () => {
    await renderLoginAndSubmit("/login", "PLATFORM_ADMIN");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/platform"), { timeout: 2000 });
  });
});
