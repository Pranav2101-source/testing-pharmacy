import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { getDownloadErrorMessage, getErrorMessage } from "./api-client";

/**
 * These two functions decide the sentence a pharmacist reads when something goes
 * wrong mid-shift. Every branch here maps to a failure a till actually hits —
 * a rejected sale, an expired session, a dead network — so the assertions are
 * about whether the message tells the person what to DO, not just that a string
 * came back.
 */

/** Builds an AxiosError shaped the way the interceptor in api-client.ts leaves it. */
function axiosError(opts: {
  status?: number;
  data?: unknown;
  message?: string;
  responseType?: string;
}): AxiosError {
  // Default mirrors what axios itself sets when the interceptor has not replaced it:
  // "Request failed with status code 400". Using a made-up default here would let a
  // test pass against a string the app can never actually produce.
  const defaultMessage =
    opts.status === undefined ? "Network Error" : `Request failed with status code ${opts.status}`;
  const err = new AxiosError(
    opts.message ?? defaultMessage,
    "ERR_BAD_REQUEST",
    { headers: new AxiosHeaders(), responseType: opts.responseType } as never,
  );
  if (opts.status !== undefined) {
    err.response = {
      status: opts.status,
      statusText: "",
      data: opts.data,
      headers: {},
      config: { headers: new AxiosHeaders() } as never,
    };
  }
  return err;
}

describe("getErrorMessage", () => {
  const FALLBACK = "Could not save the bill";

  describe("server-supplied domain messages win", () => {
    // The whole point of the backend's specific 4xx text: it names the medicine,
    // the batch, the customer. A generic fallback would throw that away.
    it("surfaces the backend's error field verbatim", () => {
      const err = axiosError({
        status: 409,
        data: { success: false, error: 'Insufficient stock for "Dolo 650": 4 available, 10 requested' },
      });
      expect(getErrorMessage(err, FALLBACK)).toBe(
        'Insufficient stock for "Dolo 650": 4 available, 10 requested',
      );
    });

    it("reads a `message` key too, for any endpoint not using the standard envelope", () => {
      const err = axiosError({ status: 422, data: { message: "Return window expired" } });
      expect(getErrorMessage(err, FALLBACK)).toBe("Return window expired");
    });

    it("prefers `error` over `message` when a body carries both", () => {
      const err = axiosError({
        status: 422,
        data: { error: "Credit limit exceeded for Ramesh", message: "Unprocessable Entity" },
      });
      expect(getErrorMessage(err, FALLBACK)).toBe("Credit limit exceeded for Ramesh");
    });

    it("keeps a 422 expiry rejection intact — the batch and date are the actionable part", () => {
      const err = axiosError({
        status: 422,
        data: { error: 'Batch "B-2231" of "Amoxicillin 500" expired on 2026-01-31' },
      });
      expect(getErrorMessage(err, FALLBACK)).toContain("B-2231");
      expect(getErrorMessage(err, FALLBACK)).toContain("expired on");
    });
  });

  describe("403 is overridden on purpose", () => {
    // The backend returns the fixed string "Forbidden" by design (it must not leak
    // which rule denied the call). Correct on the wire, useless on screen.
    it("replaces the bare 'Forbidden' with an instruction", () => {
      const err = axiosError({ status: 403, data: { error: "Forbidden" } });
      const msg = getErrorMessage(err, FALLBACK);
      expect(msg).toBe("You don't have permission to do this. Ask an owner or manager for access.");
      expect(msg).not.toMatch(/forbidden/i);
    });

    it("overrides even when the server sent something more specific", () => {
      const err = axiosError({ status: 403, data: { error: "Access denied to tenant xyz" } });
      // Deliberate: a 403 body can name internal resources, so the client string wins.
      expect(getErrorMessage(err, FALLBACK)).toMatch(/don't have permission/);
    });
  });

  describe("5xx never shows a stack-trace-ish string to a pharmacist", () => {
    it("rewrites the generic 'Internal server error'", () => {
      const err = axiosError({ status: 500, data: { error: "Internal server error" } });
      expect(getErrorMessage(err, FALLBACK)).toBe(
        "Something went wrong on our end. Please try again in a moment.",
      );
    });

    it("rewrites a 500 with no body at all", () => {
      const err = axiosError({ status: 500, data: undefined });
      expect(getErrorMessage(err, FALLBACK)).toMatch(/on our end/);
    });

    it("rewrites 502/503/504 the same way", () => {
      for (const status of [502, 503, 504]) {
        expect(getErrorMessage(axiosError({ status }), FALLBACK)).toMatch(/on our end/);
      }
    });

    it("but keeps a deliberate 5xx message when the server wrote a real one", () => {
      const err = axiosError({ status: 503, data: { error: "Scheduled maintenance until 02:00 IST" } });
      expect(getErrorMessage(err, FALLBACK)).toBe("Scheduled maintenance until 02:00 IST");
    });
  });

  describe("no response — the offline till", () => {
    it("uses the interceptor's network message rather than the caller's fallback", () => {
      // A pharmacy on Indian mobile broadband hits this constantly. "Could not save
      // the bill" implies the bill was rejected; the network message says to retry.
      const err = axiosError({
        message: "Network error — check your internet connection and try again.",
      });
      expect(getErrorMessage(err, FALLBACK)).toBe(
        "Network error — check your internet connection and try again.",
      );
    });

    it("falls back only when there is genuinely nothing else", () => {
      const err = axiosError({ message: "" });
      expect(getErrorMessage(err, FALLBACK)).toBe(FALLBACK);
    });

    // An exception whose message is blank serialises as `"error": ""`. Before the
    // blank guard that empty string won every fallback chain and the user got a
    // toast they could see but not read.
    it("treats a blank server message as absent rather than showing an empty toast", () => {
      expect(getErrorMessage(axiosError({ status: 400, data: { error: "" } }), FALLBACK)).toBe(FALLBACK);
      expect(getErrorMessage(axiosError({ status: 400, data: { error: "   " } }), FALLBACK)).toBe(FALLBACK);
      expect(getErrorMessage(axiosError({ status: 400, data: { message: "" } }), FALLBACK)).toBe(FALLBACK);
    });
  });

  describe("non-axios throwables", () => {
    it("returns the fallback for a plain Error", () => {
      expect(getErrorMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
    });

    it("returns the fallback for null/undefined/string throws", () => {
      expect(getErrorMessage(null, FALLBACK)).toBe(FALLBACK);
      expect(getErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
      expect(getErrorMessage("something", FALLBACK)).toBe(FALLBACK);
    });
  });

  describe("4xx that are not 403", () => {
    it("passes a 429 rate-limit message through", () => {
      const err = axiosError({
        status: 429,
        message: "Too many requests — please wait a moment and try again.",
      });
      expect(getErrorMessage(err, FALLBACK)).toMatch(/Too many requests/);
    });

    it("passes a 400 validation message through", () => {
      const err = axiosError({ status: 400, data: { error: "quantity: must be greater than 0" } });
      expect(getErrorMessage(err, FALLBACK)).toBe("quantity: must be greater than 0");
    });

    it("passes a 404 through", () => {
      const err = axiosError({ status: 404, data: { error: "Invoice not found" } });
      expect(getErrorMessage(err, FALLBACK)).toBe("Invoice not found");
    });

    // Reached whenever a response has no `{ error }` envelope — a Tomcat-level 400,
    // an HTML page from a proxy, a gateway timeout. "Request failed with status code
    // 400" is jargon; the caller's fallback names the actual operation.
    it("prefers the caller's fallback over axios's auto-generated status message", () => {
      const err = axiosError({ status: 400, message: "Request failed with status code 400" });
      expect(getErrorMessage(err, FALLBACK)).toBe(FALLBACK);
    });

    it("still prefers the interceptor's friendly message over the fallback", () => {
      // Must not be swallowed by the rule above: these are hand-written, not axios's.
      const offline = axiosError({
        message: "Network error — check your internet connection and try again.",
      });
      expect(getErrorMessage(offline, FALLBACK)).toMatch(/check your internet/);

      const limited = axiosError({
        status: 429,
        message: "Too many requests — please wait a moment and try again.",
      });
      expect(getErrorMessage(limited, FALLBACK)).toMatch(/Too many requests/);
    });
  });
});

describe("getDownloadErrorMessage", () => {
  const FALLBACK = "Failed to export";

  // Regression guard: responseType "blob" makes axios wrap the JSON error body in a
  // Blob, so every export in the app used to report the generic fallback no matter
  // what the server said.
  it("reads the real reason back out of a Blob error body", async () => {
    const err = axiosError({
      status: 400,
      responseType: "blob",
      data: new Blob([JSON.stringify({ error: "Export range cannot exceed 1 year" })], {
        type: "application/json",
      }),
    });
    await expect(getDownloadErrorMessage(err, FALLBACK)).resolves.toBe(
      "Export range cannot exceed 1 year",
    );
  });

  it("reads a `message` key out of the Blob as well", async () => {
    const err = axiosError({
      status: 400,
      responseType: "blob",
      data: new Blob([JSON.stringify({ message: "No rows matched these filters" })]),
    });
    await expect(getDownloadErrorMessage(err, FALLBACK)).resolves.toBe(
      "No rows matched these filters",
    );
  });

  it("falls back cleanly when the Blob is not JSON (e.g. an HTML error page)", async () => {
    const err = axiosError({
      status: 502,
      responseType: "blob",
      data: new Blob(["<html><body>502 Bad Gateway</body></html>"], { type: "text/html" }),
    });
    // Must not surface raw HTML; 5xx handling takes over.
    const msg = await getDownloadErrorMessage(err, FALLBACK);
    expect(msg).not.toContain("<html>");
    expect(msg).toMatch(/on our end/);
  });

  it("falls back when the Blob is empty", async () => {
    const err = axiosError({
      status: 400,
      responseType: "blob",
      data: new Blob([]),
      message: "Request failed with status code 400",
    });
    await expect(getDownloadErrorMessage(err, FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("behaves exactly like getErrorMessage for a normal JSON error", async () => {
    const err = axiosError({ status: 422, data: { error: "Report period is in the future" } });
    await expect(getDownloadErrorMessage(err, FALLBACK)).resolves.toBe(
      getErrorMessage(err, FALLBACK),
    );
  });

  it("still applies the 403 override on a failed download", async () => {
    const err = axiosError({ status: 403, responseType: "blob", data: new Blob([]) });
    await expect(getDownloadErrorMessage(err, FALLBACK)).resolves.toMatch(/don't have permission/);
  });
});
