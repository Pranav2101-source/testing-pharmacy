import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicConnectionPanel } from "./ClinicConnectionPanel";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * The pairing flow is the "wow" moment of this screen: a pharmacist generates a
 * code, and the screen is supposed to notice — on its own, without a refresh —
 * the instant a clinic redeems it. That live transition is the one behavior in
 * this component a typecheck or a lint pass cannot catch, which is exactly why
 * it gets the most coverage here.
 *
 * api-client is mocked at the module boundary rather than with a fetch mock or
 * MSW: this codebase's `api` is a single shared axios instance imported by name
 * everywhere, so replacing its methods is the smallest surface that keeps every
 * other import (`getErrorMessage`, interceptors) real.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

const mockApi = api as unknown as {
  get:    ReturnType<typeof vi.fn>;
  post:   ReturnType<typeof vi.fn>;
  put:    ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

type Status = {
  pharmacyId: string; pharmacyName: string; pharmacyUrl: string;
  clinicName: string | null; callbackUrl: string | null; keyIssued: boolean;
  connectedAt: string | null; keyUpdatedAt: string | null;
  prescriptionsReceived: number; lastPrescriptionAt: string | null;
  pendingDispenseUpdates: number; failedDispenseUpdates: number;
  paired: boolean; pairedAt: string | null;
};

function disconnectedStatus(overrides: Partial<Status> = {}): Status {
  return {
    pharmacyId: "ph_1", pharmacyName: "Rainbow Pharmacy",
    pharmacyUrl: "https://rainbow.checkup.care",
    clinicName: null, callbackUrl: null, keyIssued: false,
    connectedAt: null, keyUpdatedAt: null,
    prescriptionsReceived: 0, lastPrescriptionAt: null,
    pendingDispenseUpdates: 0, failedDispenseUpdates: 0,
    paired: false, pairedAt: null,
    ...overrides,
  };
}

function pairedStatus(overrides: Partial<Status> = {}): Status {
  return disconnectedStatus({
    clinicName: "Apollo Clinic", callbackUrl: "https://apollo.example/webhook",
    connectedAt: "2026-08-20T10:00:00Z", paired: true, pairedAt: "2026-08-20T10:00:00Z",
    ...overrides,
  });
}

function ok<T>(data: T) {
  return Promise.resolve({ data: { data } });
}

/** Shaped so axios.isAxiosError(err) — which getErrorMessage relies on — is true. */
function axiosError(status: number, body: Record<string, unknown> = {}) {
  return { isAxiosError: true, response: { status, data: body } };
}

function renderPanel(pollIntervalMs?: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ClinicConnectionPanel pollIntervalMs={pollIntervalMs} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function setRole(role: "OWNER" | "MANAGER" | "STAFF") {
  localStorage.setItem("checkup_user", JSON.stringify({ role }));
}

beforeEach(() => {
  setRole("OWNER");
  // jsdom does not implement the Clipboard API at all.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  window.confirm = vi.fn().mockReturnValue(true);
});

describe("ClinicConnectionPanel: loading and error states", () => {
  it("shows a loading skeleton before the status resolves", () => {
    mockApi.get.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderPanel();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows a retry affordance when the status call fails, without implying billing is affected", async () => {
    mockApi.get.mockRejectedValue(axiosError(500));
    renderPanel();

    expect(await screen.findByText(/clinic connection is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/billing and prescriptions are unaffected/i)).toBeInTheDocument();

    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText(/connect your clinic in one step/i)).toBeInTheDocument();
  });
});

describe("ClinicConnectionPanel: disconnected — pairing is the default door", () => {
  it("opens on the pairing tab with a single clear call to action", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    renderPanel();

    expect(await screen.findByText(/connect your clinic in one step/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate pairing code/i })).toBeInTheDocument();
    // The manual door exists but is not the one shown first.
    expect(screen.queryByText(/give these to your clinic/i)).not.toBeInTheDocument();
  });

  it("generating a code reveals the pharmacy URL and the code, both copyable", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));

    expect(await screen.findByText("pk-code-abc123")).toBeInTheDocument();
    expect(screen.getByText("https://rainbow.checkup.care")).toBeInTheDocument();
    expect(mockApi.post).toHaveBeenCalledWith("/pharmacy/emr-connection/key");
  });

  it("copying the code writes the plaintext to the clipboard, not the masked display", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));
    await screen.findByText("pk-code-abc123");

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    const lastCopyButton = copyButtons.at(-1);
    if (!lastCopyButton) throw new Error("Expected at least one Copy button");
    await userEvent.click(lastCopyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pk-code-abc123");
  });

  it("shows a live waiting indicator once a code is issued", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));

    expect(await screen.findByText(/waiting for your clinic to enter this/i)).toBeInTheDocument();
  });

  it("regenerating a code that's already been shared asks for confirmation first", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));
    await screen.findByText(/waiting for your clinic to enter this/i);

    await userEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/stop working immediately/i));
    expect(mockApi.post).toHaveBeenCalledTimes(2);
  });

  it("declining the regenerate confirmation leaves the outstanding code untouched", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));
    await screen.findByText(/waiting for your clinic to enter this/i);

    window.confirm = vi.fn().mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(screen.getByText("pk-code-abc123")).toBeInTheDocument();
  });

  it("a failed generation surfaces the server's message as a toast, not a silent no-op", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockRejectedValue(axiosError(503, { error: "EMR integration is not configured" }));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));

    expect(await screen.findByText("EMR integration is not configured")).toBeInTheDocument();
    // And the screen does not silently pretend a code exists.
    expect(screen.queryByText(/waiting for your clinic/i)).not.toBeInTheDocument();
  });

  it("staff without OWNER/MANAGER cannot generate a code, and are told who can", async () => {
    setRole("STAFF");
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    renderPanel();

    await screen.findByText(/connect your clinic in one step/i);
    expect(screen.queryByRole("button", { name: /generate pairing code/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an owner or manager to generate a code/i)).toBeInTheDocument();
    expect(screen.getByText(/only an owner or manager can connect a clinic/i)).toBeInTheDocument();
  });
});

describe("ClinicConnectionPanel: the auto-resolving pairing moment", () => {
  // Real timers throughout, with a fast poll interval passed in as a prop —
  // deliberately not vi.useFakeTimers(): react-query's refetchInterval,
  // testing-library's findBy*/waitFor, and userEvent all schedule their own
  // internal timers, and faking the clock for one starves the others of the
  // real time they need to resolve, producing a hang rather than a fast test.
  // A tiny real interval exercises the exact same refetchInterval code path
  // production uses, just on a timescale a test can afford.

  it("flips to connected and celebrates the instant the clinic redeems the code — no refresh", async () => {
    let paired = false;
    mockApi.get.mockImplementation(() => ok(paired ? pairedStatus() : disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel(30);

    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));
    await screen.findByText(/waiting for your clinic to enter this/i);

    // The clinic redeems the code on its own — nothing the pharmacist does
    // causes this. The panel is only supposed to notice on its next poll.
    paired = true;

    expect(await screen.findByText(/prescriptions will start arriving automatically/i, {}, { timeout: 2000 }))
      .toBeInTheDocument();

    // Settles into the ordinary connected view afterwards, unprompted. Scoped to
    // the celebration's own sub-copy rather than "Apollo Clinic is connected" —
    // that phrase also appears in the (correctly, separately) still-visible
    // success toast, so asserting on it here would be testing the wrong thing.
    await waitFor(() => {
      expect(screen.queryByText(/prescriptions will start arriving automatically/i)).not.toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getAllByText("Apollo Clinic").length).toBeGreaterThan(0);
    expect(screen.getByText(/^paired$/i)).toBeInTheDocument();
  });

  it("stops polling once connected, so it does not keep hitting the API forever", async () => {
    let paired = false;
    mockApi.get.mockImplementation(() => ok(paired ? pairedStatus() : disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "pk-code-abc123", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel(30);

    await userEvent.click(await screen.findByRole("button", { name: /generate pairing code/i }));
    await screen.findByText(/waiting for your clinic to enter this/i);

    paired = true;
    await waitFor(() => expect(screen.getAllByText("Apollo Clinic").length).toBeGreaterThan(0),
      { timeout: 2000 });

    const callsAtConnect = mockApi.get.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mockApi.get.mock.calls.length).toBe(callsAtConnect);
  });
});

describe("ClinicConnectionPanel: connected state reflects how it got connected", () => {
  it("a paired connection shows the Paired badge and no manual rotate control", async () => {
    mockApi.get.mockResolvedValue(ok(pairedStatus()));
    renderPanel();

    expect(await screen.findByText(/^paired$/i)).toBeInTheDocument();
    expect(screen.getByText("Apollo Clinic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate a new key|generate key/i })).not.toBeInTheDocument();
  });

  it("a manually-connected pharmacy shows Connected without the Paired badge, and can rotate its key", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus({
      clinicName: "Manual Clinic", callbackUrl: "https://manual.example/webhook",
      keyIssued: true, connectedAt: "2026-08-10T10:00:00Z",
      keyUpdatedAt: "2026-08-10T10:00:00Z",
    })));
    renderPanel();

    expect(await screen.findByText("Manual Clinic")).toBeInTheDocument();
    expect(screen.queryByText(/^paired$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate a new key/i })).toBeInTheDocument();
  });

  it("disconnecting asks for confirmation, then revokes the credential", async () => {
    mockApi.get.mockResolvedValue(ok(pairedStatus()));
    mockApi.delete.mockResolvedValue(ok(disconnectedStatus()));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/disconnect this clinic/i));
    expect(mockApi.delete).toHaveBeenCalledWith("/pharmacy/emr-connection");
  });

  it("declining the confirmation leaves the connection untouched", async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    mockApi.get.mockResolvedValue(ok(pairedStatus()));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it("staff cannot see a disconnect button on a connected clinic", async () => {
    setRole("STAFF");
    mockApi.get.mockResolvedValue(ok(pairedStatus()));
    renderPanel();

    await screen.findByText("Apollo Clinic");
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it("shows the live counters once prescriptions have actually flowed, and flags a failed backlog", async () => {
    mockApi.get.mockResolvedValue(ok(pairedStatus({
      prescriptionsReceived: 12, lastPrescriptionAt: "2026-08-20T09:00:00Z",
      pendingDispenseUpdates: 1, failedDispenseUpdates: 3,
    })));
    renderPanel();

    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the counters entirely for a fresh connection nothing has flowed through yet", async () => {
    mockApi.get.mockResolvedValue(ok(pairedStatus()));
    renderPanel();

    await screen.findByText("Apollo Clinic");
    expect(screen.queryByText(/prescriptions received/i)).not.toBeInTheDocument();
  });
});

describe("ClinicConnectionPanel: manual fallback door", () => {
  it("switching tabs reveals the original three-step flow, unchanged", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    expect(screen.getByText(/give these to your clinic/i)).toBeInTheDocument();
    expect(screen.getByText("ph_1")).toBeInTheDocument();
    expect(screen.getByText(/point dispensing updates back at the clinic/i)).toBeInTheDocument();
  });

  it("the save button stays disabled until both clinic name and callback URL are filled", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    const save = screen.getByRole("button", { name: /save clinic details/i });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/city health clinic/i), "Manual Clinic");
    expect(save).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText(/webhooks\/dispense/i),
      "https://manual.example/webhook",
    );
    expect(save).toBeEnabled();
  });

  it("saving clinic details calls the update endpoint with the trimmed values", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.put.mockResolvedValue(ok(disconnectedStatus({
      clinicName: "Manual Clinic", callbackUrl: "https://manual.example/webhook",
    })));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    await userEvent.type(screen.getByPlaceholderText(/city health clinic/i), "  Manual Clinic  ");
    await userEvent.type(
      screen.getByPlaceholderText(/webhooks\/dispense/i),
      "  https://manual.example/webhook  ",
    );
    await userEvent.click(screen.getByRole("button", { name: /save clinic details/i }));

    expect(mockApi.put).toHaveBeenCalledWith("/pharmacy/emr-connection", {
      clinicName: "Manual Clinic",
      callbackUrl: "https://manual.example/webhook",
    });
    expect(await screen.findByText(/clinic details saved/i)).toBeInTheDocument();
  });

  it("a failed save surfaces the error rather than silently discarding the form", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.put.mockRejectedValue(axiosError(400, { error: "The clinic address must be a full http(s) URL" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    await userEvent.type(screen.getByPlaceholderText(/city health clinic/i), "Manual Clinic");
    // Syntactically a URL (so the browser's native type="url" constraint lets the
    // form submit) but not http(s) — the exact case the backend's own validation
    // exists to catch.
    await userEvent.type(screen.getByPlaceholderText(/webhooks\/dispense/i), "ftp://clinic.example");
    await userEvent.click(screen.getByRole("button", { name: /save clinic details/i }));

    expect(await screen.findByText(/must be a full http\(s\) url/i)).toBeInTheDocument();
  });

  it("rotating an already-issued manual key asks for confirmation first", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus({
      clinicName: "Manual Clinic", callbackUrl: "https://manual.example/webhook",
      keyIssued: true, connectedAt: "2026-08-10T10:00:00Z", keyUpdatedAt: "2026-08-10T10:00:00Z",
    })));
    mockApi.post.mockResolvedValue(ok({ key: "new-manual-secret", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /generate a new key/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/stop working immediately/i));
    expect(mockApi.post).toHaveBeenCalledWith("/pharmacy/emr-connection/key");
  });

  it("declining the manual-key rotation confirmation makes no request at all", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus({
      clinicName: "Manual Clinic", callbackUrl: "https://manual.example/webhook",
      keyIssued: true, connectedAt: "2026-08-10T10:00:00Z", keyUpdatedAt: "2026-08-10T10:00:00Z",
    })));
    window.confirm = vi.fn().mockReturnValue(false);
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /generate a new key/i }));

    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it("generating a FIRST manual key (nothing to lose yet) skips the confirmation entirely", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "manual-secret-value", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    await userEvent.click(screen.getByRole("button", { name: /^generate key$/i }));

    expect(window.confirm).not.toHaveBeenCalled();
    expect(mockApi.post).toHaveBeenCalledWith("/pharmacy/emr-connection/key");
  });

  it("the manual key is revealed on generation (it must be copied before it's gone), and can be masked and unmasked", async () => {
    mockApi.get.mockResolvedValue(ok(disconnectedStatus()));
    mockApi.post.mockResolvedValue(ok({ key: "manual-secret-value", generatedAt: "2026-08-20T10:00:00Z" }));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /connect manually/i }));

    await userEvent.click(screen.getByRole("button", { name: /generate key/i }));

    expect(await screen.findByText(/shown once — copy it now/i)).toBeInTheDocument();
    // Visible immediately: a secret shown exactly once is not useful hidden behind
    // an extra click the pharmacist has to know to make before it disappears.
    expect(screen.getByText("manual-secret-value")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /hide key/i }));
    expect(screen.queryByText("manual-secret-value")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show key/i }));
    expect(screen.getByText("manual-secret-value")).toBeInTheDocument();
  });
});
