import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClinicPrescriptionTriage, { type TriagePrescription } from "./ClinicPrescriptionTriage";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";
import { storeUser } from "@/lib/auth";

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

function renderTriage(rx: TriagePrescription, onChanged: () => void = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ClinicPrescriptionTriage rx={rx} onClose={vi.fn()} onChanged={onChanged} onOpenFullDetail={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The chip's link and the warning's fix-it link are role-gated — see PackSizeConfidenceChip. */
function signInAs(role: string) {
  storeUser({ id: "u1", name: "Test", email: "t@test.local", role, pharmacyId: "ph-1", pharmacyName: "Test" });
}

beforeEach(() => {
  localStorage.clear();
  // Call history would otherwise leak between tests ("was NOT called" assertions included).
  vi.clearAllMocks();
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
    expect(screen.getByRole("button", { name: /continue to billing/i })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /continue to billing/i })).toBeEnabled();
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

describe("ClinicPrescriptionTriage: a calculated quantity is labelled, not indistinguishable from a stated one", () => {
  it("shows a 'calculated' label next to a quantity PrescriptionQuantityCalculator derived", () => {
    renderTriage(baseRx({
      needsReview: 0,
      items: [{
        id: "i1", medicineName: "Azithromycin 500", medicineId: "med_1", schedule: null,
        quantity: 12, dispensedQty: 0, dosage: "1-0-1", duration: "6 days",
        quantityAutoCalculated: true, quantityCalculationNote: "Calculated: 1-0-1 x 6 days = 12",
      }],
    }));

    expect(screen.getByText("calculated")).toBeInTheDocument();
  });

  it("shows no such label for a quantity the clinic itself sent", () => {
    renderTriage(baseRx({
      needsReview: 0,
      items: [{
        id: "i1", medicineName: "Paracetamol 500", medicineId: "med_1", schedule: null,
        quantity: 10, dispensedQty: 0, dosage: "1-0-1", duration: "5 days",
        quantityAutoCalculated: false,
      }],
    }));

    expect(screen.queryByText("calculated")).not.toBeInTheDocument();
  });

  it("a fully-dispensed calculated line still reads as dispensed, not calculated", () => {
    renderTriage(baseRx({
      needsReview: 0,
      items: [{
        id: "i1", medicineName: "Azithromycin 500", medicineId: "med_1", schedule: null,
        quantity: 12, dispensedQty: 12, dosage: "1-0-1", duration: "6 days",
        quantityAutoCalculated: true,
      }],
    }));

    expect(screen.getByText("dispensed")).toBeInTheDocument();
    expect(screen.queryByText("calculated")).not.toBeInTheDocument();
  });
});

/**
 * The mL→pack conversion has to be ON SCREEN for every measured line, and an implausible pack
 * count has to stop the bill rather than quietly load eight bottles into the cart. Both read
 * the LIVE stock response, not the line's stored roundedPackCount — a line resolved before its
 * medicine was classified has no stored measured metadata at all, which is exactly the case
 * that produced the reported bug.
 */
describe("ClinicPrescriptionTriage: measured-line arithmetic", () => {
  const melgainLine = {
    id: "i1", medicineName: "Melgain", medicineId: "med_1", schedule: null,
    quantity: 40, dispensedQty: 0, dosage: "1-0-1", duration: "4 days",
  };

  function stockWith(extra: Record<string, unknown>) {
    mockApi.get.mockResolvedValue({
      data: { data: { items: [{
        itemId: "i1", medicineId: "med_1", availableQty: 204, stockStatus: "in_stock",
        baseUnit: "ML", unit: "Bottle", ...extra,
      }] } },
    });
  }

  it("spells out the conversion even when the line stored no measured metadata", async () => {
    stockWith({ effectivePackSize: 5, projectedPackCount: 8, packCountWarning: null });
    renderTriage(baseRx({ items: [melgainLine] }));

    expect(await screen.findByText("40 ml ÷ 5 ml/bottle → 8 bottles")).toBeInTheDocument();
  });

  it("blocks both footer actions while an implausible pack count is unacknowledged", async () => {
    stockWith({
      effectivePackSize: 5, projectedPackCount: 8,
      packCountWarning: "Melgain: 40 ml would need 8 sealed bottles at the 5 ml pack size on record.",
    });
    renderTriage(baseRx({ items: [melgainLine] }));

    expect(await screen.findByText(/would need 8 sealed bottles/)).toBeInTheDocument();
    // A draft resolves through the same cart resolver, so it is gated too — parking the line
    // would only bake the wrong pack count in for whoever bills it later.
    expect(screen.getByRole("button", { name: /Continue to Billing/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save as Draft/i })).toBeDisabled();
  });

  it("a plausible pack count neither warns nor blocks", async () => {
    stockWith({ effectivePackSize: 60, projectedPackCount: 1, packCountWarning: null });
    renderTriage(baseRx({ items: [melgainLine] }));

    expect(await screen.findByText("40 ml ÷ 60 ml/bottle → 1 bottle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Billing/i })).toBeEnabled();
  });

  it("renders no conversion for a countable line", async () => {
    mockApi.get.mockResolvedValue({
      data: { data: { items: [{
        itemId: "i1", medicineId: "med_1", availableQty: 1050, stockStatus: "in_stock",
        baseUnit: "TABLET", unit: "Strip", effectivePackSize: null, projectedPackCount: null,
        packCountWarning: null,
      }] } },
    });
    renderTriage(baseRx({ items: [{ ...melgainLine, medicineName: "Pantoprazole 40mg", quantity: 16 }] }));

    expect(await screen.findByText(/Pantoprazole/)).toBeInTheDocument();
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });
});

/**
 * The plausibility ceiling only fires when the ARITHMETIC comes out strange, and a wrong pack
 * size does not reliably do that: halve a bottle volume and a two-bottle course becomes four,
 * under every ceiling, looking ordinary on every screen. The confidence chip is the part that
 * says the quiet version out loud — not "that looks odd" but "nobody has checked the number
 * this was divided by".
 */
describe("ClinicPrescriptionTriage: pack-size confidence chip", () => {
  const melgainLine = {
    id: "i1", medicineName: "Melgain", medicineId: "med_1", schedule: null,
    quantity: 40, dispensedQty: 0, dosage: "1-0-1", duration: "4 days",
  };

  function stockWith(extra: Record<string, unknown>) {
    mockApi.get.mockResolvedValue({
      data: { data: { items: [{
        itemId: "i1", medicineId: "med_1", availableQty: 204, stockStatus: "in_stock",
        baseUnit: "ML", unit: "Bottle", effectivePackSize: 60, projectedPackCount: 1,
        packCountWarning: null, ...extra,
      }] } },
    });
  }

  it("flags an unverified pack size beside a conversion that is otherwise unremarkable", async () => {
    stockWith({ packSizeConfidence: "UNVERIFIED" });
    renderTriage(baseRx({ items: [melgainLine] }));

    // The conversion itself raises no alarm — one bottle for a 40 ml course is entirely normal.
    expect(await screen.findByText("40 ml ÷ 60 ml/bottle → 1 bottle")).toBeInTheDocument();
    expect(screen.getByText(/Unverified pack size/i)).toBeInTheDocument();
    // Informational only: nothing is blocked and nothing has to be acknowledged.
    expect(screen.getByRole("button", { name: /Continue to Billing/i })).toBeEnabled();
  });

  it("links an owner or manager to the screen where the pack size can actually be confirmed", async () => {
    signInAs("MANAGER");
    stockWith({ packSizeConfidence: "UNVERIFIED" });
    renderTriage(baseRx({ items: [melgainLine] }));

    const link = await screen.findByRole("link", { name: /Unverified pack size/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/dashboard/inventory");
    expect(href).toContain("verifyPackSize=med_1");
    expect(href).toContain("search=Melgain");
  });

  it("shows anyone else the same chip, read-only, naming who can confirm it — never a link to a refusal", async () => {
    // The confirm endpoint is OWNER/MANAGER only. A pharmacist still needs to see the state,
    // but a link would land them on a screen that refuses the save.
    signInAs("PHARMACIST");
    stockWith({ packSizeConfidence: "UNVERIFIED" });
    renderTriage(baseRx({ items: [melgainLine] }));

    const chip = await screen.findByText(/Unverified pack size/i);
    expect(screen.queryByRole("link", { name: /Unverified pack size/i })).not.toBeInTheDocument();
    expect(chip.closest("span[title]")?.getAttribute("title")).toMatch(/owner or manager/i);
  });

  it("says nothing when the pack size has been verified", async () => {
    stockWith({ packSizeConfidence: "VERIFIED" });
    renderTriage(baseRx({ items: [melgainLine] }));

    expect(await screen.findByText("40 ml ÷ 60 ml/bottle → 1 bottle")).toBeInTheDocument();
    expect(screen.queryByText(/pack size/i)).not.toBeInTheDocument();
  });

  it("says nothing for a countable line, where a wrong strip count is a far smaller error", async () => {
    mockApi.get.mockResolvedValue({
      data: { data: { items: [{
        itemId: "i1", medicineId: "med_1", availableQty: 1050, stockStatus: "in_stock",
        baseUnit: "TABLET", unit: "Strip", effectivePackSize: null, projectedPackCount: null,
        packCountWarning: null, packSizeConfidence: null,
      }] } },
    });
    renderTriage(baseRx({ items: [{ ...melgainLine, medicineName: "Pantoprazole 40mg", quantity: 16 }] }));

    expect(await screen.findByText(/Pantoprazole/)).toBeInTheDocument();
    expect(screen.queryByText(/Unverified pack size/i)).not.toBeInTheDocument();
  });

  it("shows the loud version for a pack size that contradicts the record", async () => {
    stockWith({ packSizeConfidence: "DISPUTED" });
    renderTriage(baseRx({ items: [melgainLine] }));

    expect(await screen.findByText(/Pack size disputed/i)).toBeInTheDocument();
  });
});

describe("ClinicPrescriptionTriage: catalogue re-resolution on open", () => {
  it("asks the server to re-resolve stale measured lines before the pharmacist reads them", async () => {
    renderTriage(baseRx({
      items: [{
        id: "i1", medicineName: "Melgain", medicineId: "med_1", schedule: null,
        quantity: 40, dispensedQty: 0, dosage: "1-0-1", duration: "4 days",
      }],
    }));

    await vi.waitFor(() => {
      expect(mockApi.patch).toHaveBeenCalledWith("/prescriptions/rx_1/re-resolve");
    });
  });

  it("refetches the prescription only when a line actually came back different", async () => {
    const line = {
      id: "i1", medicineName: "Melgain", medicineId: "med_1", schedule: null,
      quantity: 40, dispensedQty: 0, dosage: "1-0-1", duration: "4 days",
    };
    // Nothing changed server-side: calling onChanged here refetched on every single open.
    mockApi.patch.mockResolvedValueOnce({ data: { data: { items: [{ ...line }] } } });
    const unchanged = vi.fn();
    renderTriage(baseRx({ items: [line] }), unchanged);
    await vi.waitFor(() => expect(mockApi.patch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(unchanged).not.toHaveBeenCalled();

    // A line re-resolved to one 60 ml bottle IS news, and the parent must hear it.
    mockApi.patch.mockResolvedValueOnce({ data: { data: { items: [
      { ...line, quantity: 60, roundedPackCount: 1, clinicalUom: "ML" },
    ] } } });
    const changed = vi.fn();
    renderTriage(baseRx({ id: "rx_2", items: [line] }), changed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it("does not ask at all when no line could qualify", async () => {
    // Everything is either unmatched or already has stock handed over against it — the server
    // would refuse every line, so the write request is pure overhead.
    renderTriage(baseRx({
      items: [
        { id: "i1", medicineName: "Unknown", medicineId: null, schedule: null,
          quantity: 5, dispensedQty: 0, dosage: null, duration: null },
        { id: "i2", medicineName: "Melgain", medicineId: "med_1", schedule: null,
          quantity: 60, dispensedQty: 60, dosage: null, duration: null },
      ],
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApi.patch).not.toHaveBeenCalledWith("/prescriptions/rx_1/re-resolve");
  });

  it("still renders when re-resolution fails — it is a correction, not the pharmacist's task", async () => {
    mockApi.patch.mockRejectedValueOnce(new Error("network"));
    renderTriage(baseRx({
      items: [{
        id: "i1", medicineName: "Melgain", medicineId: "med_1", schedule: null,
        quantity: 40, dispensedQty: 0, dosage: "1-0-1", duration: "4 days",
      }],
    }));

    expect(await screen.findByText(/Melgain/)).toBeInTheDocument();
  });
});
