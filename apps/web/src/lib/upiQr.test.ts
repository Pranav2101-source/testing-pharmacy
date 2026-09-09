import { describe, expect, it } from "vitest";
import { buildUpiUri } from "./upiQr";

describe("buildUpiUri", () => {
  it("builds a minimal intent URL from just a VPA", () => {
    expect(buildUpiUri({ pa: "shop@upi" })).toBe("upi://pay?pa=shop%40upi");
  });

  it("adds payee name, amount (2dp + INR) and note when supplied", () => {
    const uri = buildUpiUri({ pa: "shop@upi", pn: "Gita Medical", am: 745, tn: "PH-2026-102" });
    expect(uri).toContain("pa=shop%40upi");
    expect(uri).toContain("pn=Gita%20Medical");
    expect(uri).toContain("am=745.00");
    expect(uri).toContain("cu=INR");
    expect(uri).toContain("tn=PH-2026-102");
  });

  it("omits amount for a zero / negative value (open QR)", () => {
    expect(buildUpiUri({ pa: "shop@upi", am: 0 })).toBe("upi://pay?pa=shop%40upi");
  });
});
