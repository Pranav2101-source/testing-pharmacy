import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReviewIngestedItemsPanel from "./ReviewIngestedItemsPanel";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * The suggestion chip is the one-click path that makes the fuzzy-match catalogue lookup
 * (MedicineRepository.findSimilarByNames) actually save a pharmacist a search — see
 * PrescriptionResponse.Suggestion. It must never look like an automatic action: this
 * covers that the chip only appears for genuinely unmatched lines, links through the same
 * PATCH the manual search already used, and gets out of the way once the full search opens.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };

function renderPanel(items: Parameters<typeof ReviewIngestedItemsPanel>[0]["items"], onLinked = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onLinked,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ReviewIngestedItemsPanel prescriptionId="rx_1" items={items} onLinked={onLinked} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mockApi.patch.mockResolvedValue({ data: { data: {} } });
  mockApi.get.mockResolvedValue({ data: { data: { items: [] } } });
});

describe("ReviewIngestedItemsPanel: suggestion chip", () => {
  it("renders nothing at all when every line is already matched", () => {
    renderPanel([
      { id: "i1", medicineName: "Dolo 650 Tablet", medicineId: "med_1", quantity: 10, dosage: null, suggestions: [] },
    ]);

    expect(screen.queryByText(/needs a medicine chosen/i)).not.toBeInTheDocument();
  });

  it("shows the top suggestion for an unmatched line, with generic/strength detail", () => {
    renderPanel([{
      id: "i1", medicineName: "Dolo 650", medicineId: null, quantity: 10, dosage: null,
      suggestions: [
        { medicineId: "med_9", name: "Dolo 650 Tablet", genericName: "Paracetamol", strength: "650mg", form: "Tablet", similarity: 0.78 },
      ],
    }]);

    expect(screen.getByText(/did you mean/i)).toBeInTheDocument();
    expect(screen.getByText("Dolo 650 Tablet")).toBeInTheDocument();
    expect(screen.getByText(/paracetamol.*650mg.*tablet/i)).toBeInTheDocument();
  });

  it("an unmatched line with no suggestions shows only the manual search door", () => {
    renderPanel([
      { id: "i1", medicineName: "Totally Unknown Drug", medicineId: null, quantity: 5, dosage: null, suggestions: [] },
    ]);

    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose medicine/i })).toBeInTheDocument();
  });

  it("accepting the suggestion links it through the same PATCH the manual search uses", async () => {
    const { onLinked } = renderPanel([{
      id: "i1", medicineName: "Dolo 650", medicineId: null, quantity: 10, dosage: null,
      suggestions: [
        { medicineId: "med_9", name: "Dolo 650 Tablet", genericName: null, strength: null, form: null, similarity: 0.78 },
      ],
    }]);

    await userEvent.click(screen.getByRole("button", { name: /yes, link it/i }));

    expect(mockApi.patch).toHaveBeenCalledWith(
        "/prescriptions/rx_1/items/i1/medicine", { medicineId: "med_9" });
    expect(onLinked).toHaveBeenCalled();
  });

  it("opening the full search hides the suggestion chip — one way to pick, not two at once", async () => {
    renderPanel([{
      id: "i1", medicineName: "Dolo 650", medicineId: null, quantity: 10, dosage: null,
      suggestions: [
        { medicineId: "med_9", name: "Dolo 650 Tablet", genericName: null, strength: null, form: null, similarity: 0.78 },
      ],
    }]);

    await userEvent.click(screen.getByRole("button", { name: /choose medicine/i }));

    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search your catalogue/i)).toBeInTheDocument();
  });

  it("a missing suggestions field (older caller) is treated as no suggestions, not a crash", () => {
    const itemsWithoutSuggestionsField = [
      { id: "i1", medicineName: "Some Drug", medicineId: null, quantity: 1, dosage: null },
    ] as unknown as Parameters<typeof ReviewIngestedItemsPanel>[0]["items"];

    expect(() => renderPanel(itemsWithoutSuggestionsField)).not.toThrow();
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });

  it("a failed link surfaces the real error, and the chip stays so the pharmacist can retry", async () => {
    mockApi.patch.mockRejectedValueOnce({
      isAxiosError: true, response: { status: 409, data: { error: "Prescription is already cancelled" } },
    });
    renderPanel([{
      id: "i1", medicineName: "Dolo 650", medicineId: null, quantity: 10, dosage: null,
      suggestions: [
        { medicineId: "med_9", name: "Dolo 650 Tablet", genericName: null, strength: null, form: null, similarity: 0.78 },
      ],
    }]);

    await userEvent.click(screen.getByRole("button", { name: /yes, link it/i }));

    expect(await screen.findByText(/already cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes, link it/i })).toBeInTheDocument();
  });
});
