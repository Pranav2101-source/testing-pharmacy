/**
 * Indian states and union territories with their GST state codes.
 *
 * <p>Mirrors `common/tax/IndianState.java` — the two must stay in step, because the backend
 * rejects any state it cannot resolve from this exact list of display names.
 *
 * <p>This is a tax field, not an address field. Whether a purchase attracts IGST or CGST+SGST
 * is decided by comparing supplier state against pharmacy state, so a free-text box makes the
 * comparison a spelling contest. The live data had a supplier state recorded as "cjd9949".
 */
export interface IndianState {
  /** First two digits of a GSTIN. */
  code: string;
  name: string;
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
] as const;

/** A GSTIN is 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 check character. */
export const GSTIN_LENGTH = 15;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * The state a GSTIN belongs to, from its first two digits.
 *
 * <p>Authoritative where it applies — the code is assigned by the tax authority rather than
 * typed by whoever opened the form. Returns undefined for anything malformed instead of
 * guessing: the live data contains an 18-character "GSTIN", and inferring a state from that
 * would launder bad input into a tax decision.
 */
export function stateFromGstin(gstin: string | null | undefined): IndianState | undefined {
  const value = (gstin ?? "").trim().toUpperCase();
  if (value.length !== GSTIN_LENGTH) return undefined;
  return INDIAN_STATES.find(s => s.code === value.slice(0, 2));
}

/** Resolve a stored state, tolerating the case variants written before the list existed. */
export function normaliseState(value: string | null | undefined): IndianState | undefined {
  const needle = (value ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return INDIAN_STATES.find(s => s.name.toLowerCase() === needle);
}
