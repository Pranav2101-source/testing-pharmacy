/**
 * Shared field validation for people, phone numbers and email addresses.
 *
 * These rules were previously copy-pasted (or simply missing) per form, which is
 * how a customer could be saved with the phone "abcd" while the staff form three
 * screens away rejected it. Every rule lives here once; the Java DTOs mirror it in
 * `common/validation/ValidationPatterns.java` and the two must be changed together.
 *
 * Each `validate*` returns a user-facing message, or null when the value is fine —
 * a plain shape that drops into any form without dragging a validation library
 * into packages/utils.
 */

/**
 * A person's name: must START with a letter, then letters, marks, spaces and the
 * punctuation real names carry.
 *
 * `\p{M}` (combining marks) is not decoration — Devanagari, Tamil and Bengali build
 * vowels out of marks, so "प्रणव" is letters *and* marks. Omitting it would reject
 * every name written in an Indian script, which is a worse bug than the one this
 * rule exists to fix.
 *
 * The curly apostrophe (U+2019) is allowed because pasting from Word or a phone
 * keyboard silently produces it, and rejecting "O’Brien" while accepting "O'Brien"
 * is indistinguishable from a broken form.
 *
 * NOT for business names. "24x7 Medicos" and "A-1 Distributors" are legitimate
 * pharmacy and distributor names, so this rule must never be applied to those.
 */
const PERSON_NAME_RE = /^\p{L}[\p{L}\p{M}\s.'’-]*$/u;

/**
 * A professional's name — the same idea as PERSON_NAME, widened for the things
 * people actually write into a doctor field.
 *
 * "Dr. Sharma (Ortho)", "Dr. Sharma, MD" and "Dr. Rao MBBS/MS" are all normal
 * entries at a pharmacy counter, so brackets, commas and slashes are allowed here
 * and nowhere else. What stays blocked is the part that was ever a defect: digits.
 * A registration number belongs in the registration-number field beside it.
 */
const PROFESSIONAL_NAME_RE = /^\p{L}[\p{L}\p{M}\s.,'’()/-]*$/u;

/**
 * An account label — a staff member, a till, a desk.
 *
 * <p>The widest of the three name rules, and deliberately so. "Billing Counter 2" and
 * "Till 3" are how pharmacies actually name logins, so digits cannot be banned here
 * the way they are for a customer or a patient. What it still catches is the defect
 * that made the rule worth having: a name with NO letters in it at all — "123456",
 * "---" — which is never a name, only a placeholder someone typed to get past the
 * form.
 */
const ACCOUNT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s.,'’()/&-]*$/u;
const CONTAINS_LETTER_RE = /\p{L}/u;

/** Indian mobile: 10 digits starting 6-9. Matches the backend and the staff form. */
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Deliberately simple: one @, a dot in the domain, no spaces. Anything stricter
 * rejects addresses that are legal in practice, and the only true test of an email
 * is sending to it.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_PERSON_NAME_LENGTH = 100;

/** Strip everything that is not a digit, then cap the length. For onChange handlers. */
export function digitsOnly(raw: string, maxLength?: number): string {
  const digits = raw.replace(/\D/g, "");
  return maxLength == null ? digits : digits.slice(0, maxLength);
}

/**
 * Reduce anything a user can type or paste to the bare 10-digit national number.
 *
 * The country-code and trunk-zero strips are guarded by total length rather than
 * applied blindly, because "9198765432" is itself a valid 10-digit mobile — a naive
 * `startsWith("91")` would silently turn a real number into an 8-digit one.
 */
export function normalizeIndianMobile(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** Collapse runs of whitespace so "Ram   Kumar" and "Ram Kumar" are one person. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Drop characters a name cannot contain. For onChange handlers, so a digit typed
 * into a name field simply does not appear — the same treatment the phone fields
 * already give a letter.
 *
 * Deliberately does NOT trim or collapse spaces: doing so mid-typing would delete
 * the space the moment you press it, making "Ram Kumar" impossible to type. That is
 * `normalizeName`'s job, at submit time.
 */
export function sanitizePersonName(raw: string): string {
  return raw.replace(/[^\p{L}\p{M}\s.'’-]/gu, "");
}

export type ValidateNameOptions = {
  /** Shown in the message, e.g. "First name". */
  label?: string;
  required?: boolean;
  maxLength?: number;
};

export function validatePersonName(
  value: string,
  { label = "Name", required = true, maxLength = MAX_PERSON_NAME_LENGTH }: ValidateNameOptions = {},
): string | null {
  const name = normalizeName(value);
  if (!name) return required ? `${label} is required` : null;
  if (name.length > maxLength) return `${label} cannot be longer than ${maxLength} characters`;
  // Digits are called out separately: "can only contain letters" leaves someone
  // staring at "Ram Kumar 2" without seeing what the form objects to.
  if (/\d/.test(name)) return `${label} cannot contain numbers`;
  if (!PERSON_NAME_RE.test(name)) {
    return `${label} can only contain letters, spaces, and . ' -`;
  }
  return null;
}

/**
 * Same contract as {@link validatePersonName}, for a doctor or other professional.
 * Digits are still rejected — that was the reported defect — but the punctuation of
 * a qualification is not.
 */
export function validateProfessionalName(
  value: string,
  { label = "Name", required = true, maxLength = 200 }: ValidateNameOptions = {},
): string | null {
  const name = normalizeName(value);
  if (!name) return required ? `${label} is required` : null;
  if (name.length > maxLength) return `${label} cannot be longer than ${maxLength} characters`;
  if (/\d/.test(name)) {
    // Named separately because the fix is usually "move it to the other field",
    // not "delete it".
    return `${label} cannot contain numbers — put a registration number in its own field`;
  }
  if (!PROFESSIONAL_NAME_RE.test(name)) {
    return `${label} can only contain letters, spaces, and . , ' - ( ) /`;
  }
  return null;
}

/** Drop characters a professional name cannot contain. For onChange handlers. */
export function sanitizeProfessionalName(raw: string): string {
  return raw.replace(/[^\p{L}\p{M}\s.,'’()/-]/gu, "");
}

/**
 * Same contract as the other name rules, for a login or till label. Digits are
 * allowed; a value containing no letters at all is not.
 */
export function validateAccountName(
  value: string,
  { label = "Name", required = true, maxLength = 100 }: ValidateNameOptions = {},
): string | null {
  const name = normalizeName(value);
  if (!name) return required ? `${label} is required` : null;
  if (name.length > maxLength) return `${label} cannot be longer than ${maxLength} characters`;
  if (!CONTAINS_LETTER_RE.test(name)) return `${label} must contain at least one letter`;
  if (!ACCOUNT_NAME_RE.test(name)) {
    return `${label} can only contain letters, numbers, spaces, and . , ' - ( ) / &`;
  }
  return null;
}

export type ValidateMobileOptions = {
  label?: string;
  required?: boolean;
};

export function validateIndianMobile(
  value: string,
  { label = "Mobile number", required = true }: ValidateMobileOptions = {},
): string | null {
  const raw = value.trim();
  if (!raw) return required ? `${label} is required` : null;

  const digits = raw.replace(/\D/g, "");
  if (/[^\d\s+()-]/.test(raw)) return `${label} can only contain digits`;
  // Length first, then the leading digit: a 9-digit number is a typo, and telling
  // someone it "must start with 6-9" when it already does reads as a broken form.
  if (digits.length !== 10) return `${label} must be exactly 10 digits`;
  if (!INDIAN_MOBILE_RE.test(digits)) return `${label} must start with 6, 7, 8 or 9`;
  return null;
}

export function validateEmail(value: string, { required = false } = {}): string | null {
  const email = value.trim();
  if (!email) return required ? "Email is required" : null;
  if (!EMAIL_RE.test(email)) return "Enter a valid email address, e.g. name@example.com";
  return null;
}

/** True when every entry is null — i.e. the form may be submitted. */
export function isClean(errors: Record<string, string | null | undefined>): boolean {
  return Object.values(errors).every((e) => !e);
}
