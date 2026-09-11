import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BatchesTab } from "./BatchesTab";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";
import { storeUser } from "@/lib/auth";

/**
 * The confirm-pack-size deep link from triage's chip. It used to look the medicine up in the
 * batch list, so a medicine with no batch on the shelf — common for a line triage had just
 * marked out of stock — landed on Inventory with no dialog and no word about why.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const melgain = {
  id: "med_1", name: "Melgain Lotion", unitsPerPack: 60, packSize: null,
  baseUnit: "ML", allowLooseSale: false,
};

function signInAs(role: string) {
  storeUser({ id: "u1", name: "Test", email: "t@test.local", role, pharmacyId: "ph-1", pharmacyName: "Test" });
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BatchesTab onCountsLoaded={() => {}} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockApi.get.mockImplementation((url: string) => {
    if (url === "/medicines/med_1") return Promise.resolve({ data: { data: melgain } });
    // No batch of it on the shelf at all.
    return Promise.resolve({ data: { data: { items: [], total: 0, alertCounts: {} } } });
  });
});

describe("BatchesTab: confirm-pack-size deep link", () => {
  it("opens the confirm dialog for a medicine with no batch on the shelf", async () => {
    signInAs("OWNER");
    renderAt("/dashboard/inventory?tab=batches&verifyPackSize=med_1");

    expect(await screen.findByRole("heading", { name: /Confirm pack size/i })).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith("/medicines/med_1");
    // Pre-filled with the number billing divides by, ready to be checked against the bottle.
    expect(screen.getByLabelText(/Units per pack for Melgain Lotion/i)).toHaveValue(60);
  });

  it("explains itself to someone who cannot confirm, instead of silently doing nothing", async () => {
    signInAs("CASHIER");
    renderAt("/dashboard/inventory?tab=batches&verifyPackSize=med_1");

    expect(await screen.findByText(/Only an owner or manager can confirm a pack size/i)).toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalledWith("/medicines/med_1");
    expect(screen.queryByRole("heading", { name: /Confirm pack size/i })).not.toBeInTheDocument();
  });
});
