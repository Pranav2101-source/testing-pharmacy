import { describe, expect, it } from "vitest";
import {
  digitsOnly,
  isClean,
  normalizeIndianMobile,
  normalizeName,
  sanitizePersonName,
  sanitizeProfessionalName,
  validateAccountName,
  validateEmail,
  validateIndianMobile,
  validatePersonName,
  validateProfessionalName,
} from "./validation.js";

describe("validatePersonName", () => {
  it("accepts the punctuation real names carry", () => {
    for (const name of ["Ram Kumar", "Dr. K.S. Iyer", "O'Brien", "O’Brien", "Ram-Kumar", "D'Souza"]) {
      expect(validatePersonName(name), name).toBeNull();
    }
  });

  it("accepts names written in Indian scripts", () => {
    // Devanagari and Tamil build vowels from combining marks; a letters-only rule
    // would reject both.
    for (const name of ["प्रणव", "प्रणव राज", "பிரணவ்", "রাহুল"]) {
      expect(validatePersonName(name), name).toBeNull();
    }
  });

  it("rejects digits anywhere, with a message that names the problem", () => {
    expect(validatePersonName("Ram2")).toBe("Name cannot contain numbers");
    expect(validatePersonName("123456")).toBe("Name cannot contain numbers");
    expect(validatePersonName("Ram Kumar 2")).toBe("Name cannot contain numbers");
  });

  it("rejects a name that does not start with a letter", () => {
    expect(validatePersonName(".Ram")).not.toBeNull();
    expect(validatePersonName("-Ram")).not.toBeNull();
    expect(validatePersonName("'")).not.toBeNull();
  });

  it("rejects symbols that are not name punctuation", () => {
    expect(validatePersonName("Ram@Kumar")).not.toBeNull();
    expect(validatePersonName("Ram_Kumar")).not.toBeNull();
    expect(validatePersonName("Ram/Kumar")).not.toBeNull();
  });

  it("treats whitespace-only as empty", () => {
    expect(validatePersonName("   ")).toBe("Name is required");
    expect(validatePersonName("   ", { required: false })).toBeNull();
  });

  it("uses the supplied label and honours maxLength", () => {
    expect(validatePersonName("", { label: "First name" })).toBe("First name is required");
    expect(validatePersonName("a".repeat(101))).toBe("Name cannot be longer than 100 characters");
    expect(validatePersonName("a".repeat(101), { maxLength: 200 })).toBeNull();
  });
});

describe("validateProfessionalName", () => {
  it("accepts the qualifications pharmacists actually type into a doctor field", () => {
    for (const name of [
      "Dr. Sharma (Ortho)",
      "Dr. Sharma, MD",
      "Dr. Rao MBBS/MS",
      "Dr. K.S. O'Brien-Rao",
      "Dr. Sharma (Ortho), MS",
    ]) {
      expect(validateProfessionalName(name), name).toBeNull();
    }
  });

  it("still rejects digits, and points at the right field", () => {
    expect(validateProfessionalName("Dr. Sharma 123")).toBe(
      "Name cannot contain numbers — put a registration number in its own field",
    );
    expect(validateProfessionalName("12345")).not.toBeNull();
  });

  it("rejects symbols that belong to no name", () => {
    expect(validateProfessionalName("Dr@Sharma")).not.toBeNull();
    expect(validateProfessionalName("<script>")).not.toBeNull();
    expect(validateProfessionalName("(Ortho) Dr. Sharma")).not.toBeNull();
  });

  it("is wider than the person rule, which must stay narrow", () => {
    // The customer-name rule must NOT drift to allow these.
    expect(validatePersonName("Dr. Sharma (Ortho)")).not.toBeNull();
    expect(validateProfessionalName("Dr. Sharma (Ortho)")).toBeNull();
  });
});

describe("sanitizeProfessionalName", () => {
  it("keeps qualification punctuation but drops digits and symbols", () => {
    expect(sanitizeProfessionalName("Dr. Sharma (Ortho), MD")).toBe("Dr. Sharma (Ortho), MD");
    expect(sanitizeProfessionalName("Dr. Sharma 123")).toBe("Dr. Sharma ");
    expect(sanitizeProfessionalName("Dr@Sharma")).toBe("DrSharma");
  });
});

describe("validateAccountName", () => {
  it("accepts the way pharmacies actually name logins", () => {
    for (const name of ["Billing Counter 2", "Till 3", "Asha Menon", "Counter-1 (Front)", "R&D Desk"]) {
      expect(validateAccountName(name), name).toBeNull();
    }
  });

  it("rejects a value with no letters in it — that is a placeholder, not a name", () => {
    expect(validateAccountName("123456")).toBe("Name must contain at least one letter");
    expect(validateAccountName("---")).not.toBeNull();
    expect(validateAccountName("2")).toBe("Name must contain at least one letter");
  });

  it("is wider than both other name rules", () => {
    // The ladder: person (narrowest) -> professional -> account (widest).
    expect(validatePersonName("Billing Counter 2")).not.toBeNull();
    expect(validateProfessionalName("Billing Counter 2")).not.toBeNull();
    expect(validateAccountName("Billing Counter 2")).toBeNull();
  });

  it("still rejects junk symbols", () => {
    expect(validateAccountName("Till <script>")).not.toBeNull();
    expect(validateAccountName("Desk@2")).not.toBeNull();
  });
});

describe("validateIndianMobile", () => {
  it("accepts a plain 10-digit mobile", () => {
    expect(validateIndianMobile("9876543210")).toBeNull();
    expect(validateIndianMobile("6000000000")).toBeNull();
  });

  it("reports letters distinctly from length", () => {
    expect(validateIndianMobile("98765abcde")).toBe("Mobile number can only contain digits");
    expect(validateIndianMobile("98765")).toBe("Mobile number must be exactly 10 digits");
    expect(validateIndianMobile("98765432101")).toBe("Mobile number must be exactly 10 digits");
    expect(validateIndianMobile("1234567890")).toBe("Mobile number must start with 6, 7, 8 or 9");
  });

  it("is required by default and optional on request", () => {
    expect(validateIndianMobile("")).toBe("Mobile number is required");
    expect(validateIndianMobile("  ")).toBe("Mobile number is required");
    expect(validateIndianMobile("", { required: false })).toBeNull();
  });

  it("accepts formatting characters around a valid number", () => {
    expect(validateIndianMobile("98765 43210")).toBeNull();
    expect(validateIndianMobile("(98765) 43210")).toBeNull();
  });

  it("accepts a country code or trunk zero, matching IndianMobileValidator", () => {
    // The Java side normalises before it measures. This copy used to strip non-digits
    // only, so "+91 98765 43210" was rejected here as 12 digits while the API accepted
    // it — a number saved through the API could then block its own form on save.
    expect(validateIndianMobile("+91 98765 43210")).toBeNull();
    expect(validateIndianMobile("919876543210")).toBeNull();
    expect(validateIndianMobile("098765 43210")).toBeNull();
  });

  it("still counts an over-long number as over-long after normalising", () => {
    // The trap in normalising first: normalizeIndianMobile truncates to 10, so reusing
    // it here would have let an 11-digit number through as valid.
    expect(validateIndianMobile("98765432101")).toBe("Mobile number must be exactly 10 digits");
    expect(validateIndianMobile("9876543210999")).toBe("Mobile number must be exactly 10 digits");
  });
});

describe("normalizeIndianMobile", () => {
  it("strips country code, trunk zero and formatting", () => {
    expect(normalizeIndianMobile("+91 98765 43210")).toBe("9876543210");
    expect(normalizeIndianMobile("919876543210")).toBe("9876543210");
    expect(normalizeIndianMobile("098765 43210")).toBe("9876543210");
    expect(normalizeIndianMobile("+91-98765-43210")).toBe("9876543210");
  });

  it("leaves a real number beginning 91 intact", () => {
    // The trap a naive startsWith("91") falls into: this IS a valid 10-digit mobile.
    expect(normalizeIndianMobile("9198765432")).toBe("9198765432");
  });

  it("caps at 10 digits", () => {
    expect(normalizeIndianMobile("98765432109999")).toHaveLength(10);
  });
});

describe("digitsOnly", () => {
  it("removes non-digits and respects the cap", () => {
    expect(digitsOnly("98a76b54c32d10")).toBe("9876543210");
    expect(digitsOnly("9876543210999", 10)).toBe("9876543210");
    expect(digitsOnly("")).toBe("");
  });
});

describe("normalizeName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeName("  Ram   Kumar  ")).toBe("Ram Kumar");
  });
});

describe("sanitizePersonName", () => {
  it("drops digits and symbols as they are typed", () => {
    expect(sanitizePersonName("Ram2")).toBe("Ram");
    expect(sanitizePersonName("Ram@Kumar")).toBe("RamKumar");
    expect(sanitizePersonName("123")).toBe("");
  });

  it("keeps name punctuation and Indian scripts", () => {
    expect(sanitizePersonName("Dr. K.S. O'Brien-Rao")).toBe("Dr. K.S. O'Brien-Rao");
    expect(sanitizePersonName("प्रणव")).toBe("प्रणव");
  });

  it("leaves whitespace alone so a space can be typed mid-name", () => {
    // Trimming here would delete the space the instant it is pressed, making
    // "Ram Kumar" impossible to enter.
    expect(sanitizePersonName("Ram ")).toBe("Ram ");
    expect(sanitizePersonName("  Ram")).toBe("  Ram");
  });
});

describe("validateEmail", () => {
  it("accepts the addresses people actually use", () => {
    for (const email of [
      "asha@gmail.com",
      "asha@yahoo.co.in",
      "contact@distributor.com",
      "a.b+c@sub.domain.co.in",
      "first.last@my-pharmacy.in",
      "TILL2@Gmail.COM",
    ]) {
      expect(validateEmail(email), email).toBeNull();
    }
  });

  it("rejects a domain with no real ending — the reported defect", () => {
    // The old rule ("one @, a dot, no spaces") passed all of these, which is what
    // "validation is there but accepts anything" meant.
    expect(validateEmail("asha@gmail")).toBe("Enter a complete domain after @, e.g. gmail.com");
    expect(validateEmail("asha@gmail.")).not.toBeNull();
    expect(validateEmail("asha@.com")).not.toBeNull();
    expect(validateEmail("asha@a.b")).not.toBeNull();       // 1-char TLD
    expect(validateEmail("asha@-gmail.com")).not.toBeNull(); // label edge hyphen
    expect(validateEmail("asha@gmail-.com")).not.toBeNull();
  });

  it("rejects a malformed local part", () => {
    expect(validateEmail("not-an-email")).not.toBeNull();
    expect(validateEmail("@gmail.com")).not.toBeNull();
    expect(validateEmail(".asha@gmail.com")).not.toBeNull();
    expect(validateEmail("asha.@gmail.com")).not.toBeNull();
    expect(validateEmail("as..ha@gmail.com")).not.toBeNull();
    expect(validateEmail("as,ha@gmail.com")).not.toBeNull();
  });

  it("names the part that is wrong instead of one catch-all", () => {
    expect(validateEmail("two spaces@gmail.com")).toBe("Email cannot contain spaces");
    expect(validateEmail(`${"a".repeat(65)}@gmail.com`)).toBe("The part before @ is too long");
  });

  it("is optional by default", () => {
    expect(validateEmail("")).toBeNull();
    expect(validateEmail("  ")).toBeNull();
    expect(validateEmail("", { required: true })).toBe("Email is required");
  });
});

describe("isClean", () => {
  it("is true only when every field error is absent", () => {
    expect(isClean({ a: null, b: undefined })).toBe(true);
    expect(isClean({ a: null, b: "Name is required" })).toBe(false);
  });
});
