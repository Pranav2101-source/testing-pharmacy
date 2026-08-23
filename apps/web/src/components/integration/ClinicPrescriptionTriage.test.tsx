import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClinicPrescriptionTriage, { type TriagePrescription } from "./ClinicPrescriptionTriage";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * A prescribed line can be blocked from billing for two independent reasons — an unmatched
 * medicine, or an unconfirmed quantity (see PrescriptionItem.needsQuantityConfirmation) — and
 * this screen's one blocking banner has to name the actual one, not a hardcoded "needs
 * matching" that used to be the only reason this screen ever blocked. It also must not render
 * an unconfirmed line as struck-through/"dispensed", which `quantity - dispensedQty <= 0`
 * reads as when quantity is the zero placeholder rather than a real amount.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
};

function baseRx(overrides: Partial<TriagePrescription> = {}): TriagePrescription {
  return {
    id: "rx_1",
    prescriptionNumber: "RX-000001",
    patientName: "Asha Verma",
    patientPhone: null,
    patientAge: null,
    patientGender: null,
    doctorName: "Dr. Rao",
    doctor: null,
    prescribedDate: null,
    notes: null,
    needsReview: 0,
    items: [],
    ...overrides,
  };
}

function renderTriage(rx: TriagePrescription) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ClinicPrescriptionTriage rx={rx} onClose={vi.fn()} onChanged={vi.fn()} onOpenFullDetail={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.get.mockResolvedValue({ data: { data: { items: [] } } });
  mockApi.patch.mockResolvedValue({ data: { data: {} } });
});

describe("ClinicPrescriptionTriage: blocking banner names the actual reason", () => {
  it("an unconfirmed quantity blocks with its own message, not the medicine-matching one", () => {
    renderTriage(baseRx({
      needsReview: 1,
      items: [{
        id: "i1", medicineName: "Vitamin D3", medicineId: "med_1", schedule: null,
        quantity: 0, dispensedQty: 0, dosage: "as directed", duration: null,
      }],
    }));

    expect(screen.getByText(/1 line still needs a quantity confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs? matching to your stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bill now/i })).toBeDisabled();
  });

  it("an unmatched medicine still blocks with the matching message", () => {
    renderTriage(baseRx({
      needsReview: 1,
      items: [{
        id: "i1", medicineName: "Some Unknown Drug", medicineId: null, schedule: null,
        quantity: 5, dispensedQty: 0, dosage: null, duration: null,
      }],
    }));

    expect(screen.getByText(/1 medicine still needs matching to your stock/i)).toBeInTheDocument();
  });

  it("a line needing both is named for both reasons in one banner", () => {
    renderTriage(baseRx({
      needsReview: 1,
      items: [{
        id: "i1", medicineName: "Unknown, As Directed", medicineId: null, schedule: null,
        quantity: 0, dispensedQty: 0, dosage: null, duration: null,
      }],
    }));

    expect(screen.getByText(/1 medicine still needs matching to your stock/i)).toBeInTheDocument();
    expect(screen.getByText(/1 line still needs a quantity confirmed/i)).toBeInTheDocument();
  });

  it("no banner and both actions enabled once every line is resolved", () => {
    renderTriage(baseRx({
      needsReview: 0,
      items: [{
        id: "i1", medicineName: "Paracetamol 500", medicineId: "med_1", schedule: null,
        quantity: 10, dispensedQty: 0, dosage: "1-0-1", duration: "5 days",
      }],
    }));

    expect(screen.queryByText(/still needs?/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bill now/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /save as draft/i })).toBeEnabled();
  });
});

describe("ClinicPrescriptionTriage: an unconfirmed-quantity line is never shown as already dispensed", () => {
  it("renders 'not set', not a struck-through zero", () => {
    renderTriage(baseRx({
      needsReview: 1,
      items: [{
        id: "i1", medicineName: "Vitamin D3", medicineId: "med_1", schedule: null,
        quantity: 0, dispensedQty: 0, dosage: null, duration: null,
      }],
    }));

    expect(screen.getByText("not set")).toBeInTheDocument();
    expect(screen.queryByText("dispensed")).not.toBeInTheDocument();
    // "Vitamin D3" also appears in the ConfirmQuantityPanel row below — the item-list
    // instance (rendered first) is the one whose strike-through styling is under test.
    expect(screen.getAllByText("Vitamin D3")[0]).not.toHaveClass("line-through");
  });

  it("a genuinely fully-dispensed line (positive quantity, fully sold) still shows as dispensed", () => {
    renderTriage(baseRx({
      needsReview: 0,
      items: [{
        id: "i1", medicineName: "Paracetamol 500", medicineId: "med_1", schedule: null,
        quantity: 10, dispensedQty: 10, dosage: null, duration: null,
      }],
    }));

    expect(screen.getByText("dispensed")).toBeInTheDocument();
    expect(screen.getByText("Paracetamol 500")).toHaveClass("line-through");
  });

  it("the confirm-quantity panel offers a way to resolve the line right here", () => {
    renderTriage(baseRx({
      needsReview: 1,
      items: [{
        id: "i1", medicineName: "Vitamin D3", medicineId: "med_1", schedule: null,
        quantity: 0, dispensedQty: 0, dosage: null, duration: null,
      }],
    }));

    // ConfirmQuantityPanel's own heading, distinct from the blocking banner's "still needs" wording.
    expect(screen.getByText(/^1 line needs a quantity confirmed$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });
});
