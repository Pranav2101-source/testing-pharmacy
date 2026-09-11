import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PackSizeConfidenceChip } from "./PackSizeConfidenceChip";
import { storeUser } from "@/lib/auth";

/**
 * Confirming a pack size writes through an OWNER/MANAGER-only endpoint. Everyone still needs to
 * SEE an unverified or disputed pack size — the person handing over the bottles most of all — but
 * only the roles the endpoint accepts may be offered the action, or the chip is a door into a 403.
 */
function signInAs(role: string) {
  storeUser({ id: "u1", name: "Test", email: "t@test.local", role, pharmacyId: "ph-1", pharmacyName: "Test" });
}

beforeEach(() => localStorage.clear());

describe("PackSizeConfidenceChip: role gating", () => {
  it("is a working button for an owner", async () => {
    signInAs("OWNER");
    const onVerify = vi.fn();
    render(<PackSizeConfidenceChip confidence="UNVERIFIED" onVerify={onVerify} />);

    await userEvent.click(screen.getByRole("button", { name: /Unverified pack size/i }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("is a plain badge for a cashier, with the route out named in its tooltip", () => {
    signInAs("CASHIER");
    const onVerify = vi.fn();
    render(<PackSizeConfidenceChip confidence="DISPUTED" onVerify={onVerify} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const chip = screen.getByText(/Pack size disputed/i).closest("span[title]");
    expect(chip?.getAttribute("title")).toMatch(/ask one to check it/i);
  });

  it("offers no link to a pharmacist either", () => {
    signInAs("PHARMACIST");
    render(
      <MemoryRouter>
        <PackSizeConfidenceChip confidence="UNVERIFIED" medicineId="med_1" medicineName="Melgain" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Unverified pack size/i)).toBeInTheDocument();
  });

  it("keeps its original tooltip where no action was ever on offer", () => {
    signInAs("CASHIER");
    render(<PackSizeConfidenceChip confidence="UNVERIFIED" />);
    const chip = screen.getByText(/Unverified pack size/i).closest("span[title]");
    expect(chip?.getAttribute("title")).not.toMatch(/owner or manager/i);
  });

  it("renders nothing for a verified pack size, whatever the role", () => {
    signInAs("OWNER");
    const { container } = render(<PackSizeConfidenceChip confidence="VERIFIED" onVerify={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
