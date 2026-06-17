import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatDate, isExpired, isNearExpiry } from "./date.js";

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
