import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";
import { useBillingStore, DEFAULT_META } from "./useBillingStore";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * Reported bug: a prescription pushed from the EMR carries a patient name
 * (resolvePrescriptionToCart sets meta.customerName = rx.patientName), but Bill Now
 * left the customer box on the billing screen empty. Root cause: this component's
 * search-input branch (shown whenever there's no linked customerId — exactly the
 * case for an EMR patient, who has no customer-master record) keeps its own local
 * `query` state that was never synced from the store's customerName, unlike the
 * Doctor/Prescription comboboses right next to it in BillHeader.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function renderCombobox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CustomerSearchCombobox />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useBillingStore.getState().clear();
  mockApi.get.mockResolvedValue({ data: { data: { items: [] } } });
});

describe("CustomerSearchCombobox: unlinked prescription patient name", () => {
  it("shows the patient name a prescription set, even with no linked customerId", () => {
    useBillingStore.getState().loadDraft([], {
      ...DEFAULT_META,
      customerName:  "Ravindra",
      customerPhone: "7738387276",
    });

    renderCombobox();

    expect(screen.getByPlaceholderText("Customer Mobile / Name / Card Number")).toHaveValue("Ravindra");
  });

  it("still shows the linked-customer card, not the search box, once a real customer is picked", () => {
    useBillingStore.getState().loadDraft([], {
      ...DEFAULT_META,
      customerId:    "cust_1",
      customerName:  "Priya Shah",
      customerPhone: "9000000000",
    });

    renderCombobox();

    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Customer Mobile / Name / Card Number")).not.toBeInTheDocument();
  });

  it("clears the box when the customer is cleared elsewhere (e.g. switching Billing For to Counter)", () => {
    useBillingStore.getState().loadDraft([], { ...DEFAULT_META, customerName: "Ravindra" });
    useBillingStore.getState().setMeta({ customerName: "" });

    renderCombobox();

    expect(screen.getByPlaceholderText("Customer Mobile / Name / Card Number")).toHaveValue("");
  });
});
