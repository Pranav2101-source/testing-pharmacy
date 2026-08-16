import { describe, it, expect } from "vitest";
import { csvField, toCsv } from "./export";

/**
 * These assertions are about what Excel does with the file, not about what the string looks
 * like in a text editor. Every case here was a live defect in the two hand-rolled
 * serialisers this module replaced, and none of them looked wrong when the file was opened
 * in a code editor — which is exactly why they survived.
 */
describe("csvField", () => {
  it("leaves a plain number bare so Excel imports it as a number", () => {
    // The old serialiser quoted every field. Excel then read the whole sheet as text:
    // amounts left-aligned with a warning triangle, and SUM() over the column returned 0.
    expect(csvField(813.7)).toBe("813.7");
    expect(csvField("240")).toBe("240");
    expect(csvField(0)).toBe("0");
  });

  it("leaves ordinary text bare", () => {
    expect(csvField("Metformin 500mg")).toBe("Metformin 500mg");
    expect(csvField("B-METF-01")).toBe("B-METF-01");
  });

  it("quotes a value containing a comma, so it stays one column", () => {
    expect(csvField("1,234.50")).toBe('"1,234.50"');
    expect(csvField("Raman, Meenakshi")).toBe('"Raman, Meenakshi"');
  });

  it("doubles an embedded quote instead of ending the field early", () => {
    // Unescaped, this closes the field and shifts every later column of the row across by
    // one — which reads as data rather than as corruption.
    expect(csvField('Dolo 650 "strip"')).toBe('"Dolo 650 ""strip"""');
  });

  it("quotes newlines, so a multi-line note cannot invent a row", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField("has\r\nCRLF")).toBe('"has\r\nCRLF"');
  });

  it("quotes values whose spacing is significant", () => {
    expect(csvField("  padded  ")).toBe('"  padded  "');
  });

  it("writes null and undefined as an empty field, never the word", () => {
    // `String(null)` is "null" — a customer with no phone had that written into the call
    // list, where it reads as a value somebody might try to dial.
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField("")).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF, the line ending Excel expects", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("keeps a row intact when a field carries a comma", () => {
    const csv = toCsv([
      ["Customer", "Phone", "Lifetime Value"],
      ["Raman, Meenakshi", "9840011003", 456],
    ]);
    expect(csv.split("\r\n")[1]).toBe('"Raman, Meenakshi",9840011003,456');
  });

  it("round-trips currency and symbols unchanged, leaving encoding to the BOM", () => {
    // The quotation comparison writes ₹, ★ and an em dash into nearly every cell. The
    // serialiser must not touch them; it is the byte order mark on the Blob that makes
    // Excel read them as UTF-8 rather than as the system codepage.
    const csv = toCsv([["₹1,234.50 ★", "—"]]);
    expect(csv).toBe('"₹1,234.50 ★",—');
  });

  it("handles an empty sheet without producing a stray line", () => {
    expect(toCsv([])).toBe("");
  });
});
