import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatDate, isExpired, isNearExpiry,
  istRangeStart, istRangeEnd, istRangeParams, financialYearShort,
  istCalendarDate, istMonthStart,
} from "./date.js";

// ── IST range helpers ─────────────────────────────────────────────────────────

describe("istRangeStart / istRangeEnd", () => {
  it("anchors the start of the day to IST midnight, not UTC midnight", () => {
    // 2026-04-01 00:00 IST is 2026-03-31 18:30 UTC. Getting this wrong (parsing the
    // bare date as UTC midnight) pushes the lower bound to 05:30 IST and silently
    // drops every row recorded in the first five and a half hours of the day.
    expect(istRangeStart("2026-04-01")).toBe("2026-03-31T18:30:00.000Z");
  });

  it("anchors the end of the day to the last millisecond in IST", () => {
    expect(istRangeEnd("2027-03-31")).toBe("2027-03-31T18:29:59.999Z");
  });

  it("covers a full 24 hours minus 1ms across the two bounds", () => {
    const start = new Date(istRangeStart("2026-04-01")!).getTime();
    const end = new Date(istRangeEnd("2026-04-01")!).getTime();
    expect(end - start).toBe(86_400_000 - 1);
  });

  it("is independent of the host machine's timezone", () => {
    // Same call, two very different host zones — the IST anchor must not move.
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const la = istRangeStart("2026-04-01");
      process.env.TZ = "Asia/Kolkata";
      const ist = istRangeStart("2026-04-01");
      expect(la).toBe(ist);
    } finally {
      process.env.TZ = original;
    }
  });

  it("returns null for empty or unparseable input instead of throwing", () => {
    // new Date("").toISOString() raises RangeError — a cleared date field must not
    // take down the query function that builds the request.
    expect(istRangeStart("")).toBeNull();
    expect(istRangeEnd("")).toBeNull();
    expect(istRangeStart("not-a-date")).toBeNull();
    expect(istRangeEnd("2026-13-45")).toBeNull();
  });
});

describe("istRangeParams", () => {
  it("returns both bounds when both dates are valid", () => {
    expect(istRangeParams("2026-04-01", "2027-03-31")).toEqual({
      from: "2026-03-31T18:30:00.000Z",
      to: "2027-03-31T18:29:59.999Z",
    });
  });

  it("omits a bound rather than sending an invalid value", () => {
    expect(istRangeParams("", "2027-03-31")).toEqual({ to: "2027-03-31T18:29:59.999Z" });
    expect(istRangeParams("2026-04-01", "")).toEqual({ from: "2026-03-31T18:30:00.000Z" });
    expect(istRangeParams("", "")).toEqual({});
  });
});

// ── formatDate ────────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats a Date object in default DD/MM/YYYY", () => {
    expect(formatDate(new Date(2025, 0, 5))).toBe("05/01/2025"); // Jan 5 2025
  });

  it("formats a date string in default DD/MM/YYYY", () => {
    expect(formatDate("2025-06-15")).toBe("15/06/2025");
  });

  it("pads single-digit day and month with leading zero", () => {
    expect(formatDate(new Date(2025, 2, 3))).toBe("03/03/2025"); // Mar 3
  });

  it("respects a custom format string", () => {
    expect(formatDate(new Date(2025, 11, 31), "YYYY-MM-DD")).toBe("2025-12-31");
  });

  it("day/month boundary — last day of month", () => {
    expect(formatDate(new Date(2025, 1, 28))).toBe("28/02/2025"); // Feb 28
  });

  it("year is always 4 digits", () => {
    const result = formatDate(new Date(2025, 0, 1));
    expect(result.split("/")[2]).toHaveLength(4);
  });
});

// ── isExpired ─────────────────────────────────────────────────────────────────

describe("isExpired", () => {
  beforeEach(() => {
    // Fix "now" to 2025-06-16 noon UTC so tests don't flip at midnight
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-16T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("past date is expired", () => {
    expect(isExpired("2025-01-01")).toBe(true);
  });

  it("future date is not expired", () => {
    expect(isExpired("2026-01-01")).toBe(false);
  });

  it("accepts a Date object", () => {
    expect(isExpired(new Date("2020-01-01"))).toBe(true);
    expect(isExpired(new Date("2030-01-01"))).toBe(false);
  });

  it("expiry exactly today is not expired (same-day edge case)", () => {
    // "2025-06-16" parsed as UTC midnight is BEFORE "now" (noon UTC) → expired
    // This documents the current behaviour so any change is explicit.
    expect(isExpired("2025-06-16")).toBe(true);
  });
});

// ── isNearExpiry ──────────────────────────────────────────────────────────────

describe("isNearExpiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-16T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("expires within the threshold → near expiry", () => {
    // Expires in 30 days, threshold 90 → true
    expect(isNearExpiry("2025-07-16", 90)).toBe(true);
  });

  it("expires outside the threshold → not near expiry", () => {
    // Expires in 120 days, threshold 90 → false
    expect(isNearExpiry("2025-10-14", 90)).toBe(false);
  });

  it("already expired → not near expiry (function is for future dates only)", () => {
    expect(isNearExpiry("2024-01-01", 90)).toBe(false);
  });

  it("expires exactly on the threshold boundary → near expiry", () => {
    // Exactly 90 days from now (2025-09-14)
    expect(isNearExpiry("2025-09-14", 90)).toBe(true);
  });

  it("default threshold is 90 days", () => {
    const in60Days = new Date("2025-06-16T12:00:00Z");
    in60Days.setDate(in60Days.getDate() + 60);
    expect(isNearExpiry(in60Days)).toBe(true);
  });

  it("custom threshold — 30 days", () => {
    // Expires in 45 days: not near with 30-day threshold
    expect(isNearExpiry("2025-07-31", 30)).toBe(false);
    // Expires in 20 days: near with 30-day threshold
    expect(isNearExpiry("2025-07-06", 30)).toBe(true);
  });

  it("expires tomorrow → near expiry for any positive threshold", () => {
    expect(isNearExpiry("2025-06-17", 1)).toBe(true);
  });
});

describe("financialYearShort", () => {
  // Must stay identical to DocumentSequenceService.fyShort() on the backend: this
  // one renders the Invoice Settings preview, that one stamps the actual bill.
  it("returns the FY that started in April for a date after April 1", () => {
    expect(financialYearShort(new Date("2026-08-02T12:00:00+05:30"))).toBe("26-27");
  });

  it("returns the PREVIOUS April's FY for a date before April 1", () => {
    expect(financialYearShort(new Date("2026-02-15T12:00:00+05:30"))).toBe("25-26");
  });

  it("rolls over exactly on April 1 IST, not a day early or late", () => {
    // 31 March 23:59 IST is still the old year; 1 April 00:00 IST is the new one.
    expect(financialYearShort(new Date("2026-03-31T23:59:59+05:30"))).toBe("25-26");
    expect(financialYearShort(new Date("2026-04-01T00:00:00+05:30"))).toBe("26-27");
  });

  it("uses IST regardless of the host timezone", () => {
    // 2026-03-31 21:00 UTC is 2026-04-01 02:30 IST — already the new financial
    // year in India even though it is still March almost everywhere else.
    expect(financialYearShort(new Date("2026-03-31T21:00:00Z"))).toBe("26-27");
    // And the mirror case: 2026-04-01 00:30 UTC is 06:00 IST, same day, new FY.
    expect(financialYearShort(new Date("2026-04-01T00:30:00Z"))).toBe("26-27");
    // 2026-03-31 10:00 UTC is 15:30 IST — still the old FY.
    expect(financialYearShort(new Date("2026-03-31T10:00:00Z"))).toBe("25-26");
  });

  it("zero-pads a century boundary", () => {
    expect(financialYearShort(new Date("2099-06-01T12:00:00+05:30"))).toBe("99-00");
    expect(financialYearShort(new Date("2100-06-01T12:00:00+05:30"))).toBe("00-01");
  });

  it("produces the two-digit hyphenated form the backend emits", () => {
    expect(financialYearShort(new Date("2026-08-02T12:00:00+05:30"))).toMatch(/^\d{2}-\d{2}$/);
  });
});

describe("istCalendarDate / istMonthStart", () => {
  it("returns the IST date, not the UTC date", () => {
    // 02:00 IST on the 8th is still the 7th in UTC. A date box filled from the UTC
    // value showed yesterday, so a report defaulting to "today" silently omitted
    // everything sold since IST midnight.
    expect(istCalendarDate(new Date("2026-08-08T02:00:00+05:30"))).toBe("2026-08-08");
    expect(istCalendarDate(new Date("2026-08-08T23:59:00+05:30"))).toBe("2026-08-08");
    expect(istCalendarDate(new Date("2026-08-08T00:00:00+05:30"))).toBe("2026-08-08");
  });

  it("month start is the 1st, not the previous month's last day", () => {
    // The original defect: new Date(y, m, 1) is LOCAL midnight, which in IST is
    // 18:30 UTC on the last day of the previous month — so a GST summary defaulting
    // to "this month" began one day early, in the previous filing period.
    expect(istMonthStart(new Date("2026-08-08T11:00:00+05:30"))).toBe("2026-08-01");
    expect(istMonthStart(new Date("2026-08-01T00:05:00+05:30"))).toBe("2026-08-01");
    expect(istMonthStart(new Date("2026-01-15T11:00:00+05:30"))).toBe("2026-01-01");
  });

  it("round-trips through the range helpers", () => {
    const day = istCalendarDate(new Date("2026-08-08T02:00:00+05:30"));
    expect(istRangeStart(day)).toBe("2026-08-07T18:30:00.000Z"); // IST midnight of the 8th
    expect(istRangeEnd(day)).toBe("2026-08-08T18:29:59.999Z");
  });

  it("returns empty string for an invalid date rather than throwing", () => {
    expect(istCalendarDate(new Date("nonsense"))).toBe("");
  });
});
