package com.checkup.pharmacy.common.validation;

import java.util.regex.Pattern;

/**
 * Field-shape rules shared by every DTO.
 *
 * <p>These mirror {@code packages/utils/src/validation.ts} one-for-one. The frontend
 * copy exists so a user is told about a bad value while typing; this copy exists
 * because the API is reachable without the frontend. They must be changed together —
 * if they drift, a form accepts what the server then rejects (or worse, the reverse).
 */
public final class ValidationPatterns {

    private ValidationPatterns() {
    }

    /**
     * A person's name: starts with a letter, then letters, combining marks, spaces and
     * the punctuation real names carry.
     *
     * <p>{@code \p{M}} is required, not cosmetic: Devanagari, Tamil and Bengali compose
     * vowels from combining marks, so "प्रणव" is letters <em>and</em> marks. A
     * letters-only rule would reject every name written in an Indian script.
     *
     * <p>The curly apostrophe is written as a unicode escape so the meaning of this
     * pattern cannot depend on the encoding the file happens to be compiled with.
     *
     * <p><strong>Not for business names.</strong> "24x7 Medicos" and "A-1 Distributors"
     * are legitimate pharmacy and distributor names.
     */
    public static final Pattern PERSON_NAME = Pattern.compile("^\\p{L}[\\p{L}\\p{M}\\s.'\u2019-]*$");

    /**
     * A professional's name — {@link #PERSON_NAME} widened for what people actually
     * write into a doctor field.
     *
     * <p>"Dr. Sharma (Ortho)", "Dr. Sharma, MD" and "Dr. Rao MBBS/MS" are normal
     * entries at a counter, so brackets, commas and slashes are allowed here and
     * nowhere else. What stays blocked is the part that was ever a defect: digits. A
     * registration number belongs in the registration-number field beside it.
     */
    public static final Pattern PROFESSIONAL_NAME = Pattern.compile("^\\p{L}[\\p{L}\\p{M}\\s.,'\u2019()/-]*$");

    /** Indian mobile: ten digits starting 6-9. */
    public static final Pattern INDIAN_MOBILE = Pattern.compile("^[6-9]\\d{9}$");

    /**
     * Email, split into its two halves so a bad local part can be reported separately
     * from a bad domain.
     *
     * <p>Jakarta's own {@code @Email} is deliberately permissive — it accepts
     * {@code name@gmail} and {@code a@b} — which QA reported as "validation is there
     * but accepts anything". EMAIL_DOMAIN is the half that fixes it: one or more
     * labels that start and end alphanumeric, then a TLD of 2-24 letters.
     *
     * <p>Mirrors EMAIL_LOCAL_RE / EMAIL_DOMAIN_RE in {@code packages/utils/src/validation.ts}.
     */
    public static final Pattern EMAIL_LOCAL =
            Pattern.compile("^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$");
    public static final Pattern EMAIL_DOMAIN =
            Pattern.compile("^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,24}$");

    /** RFC 5321 limits: 64 octets for the local part, 254 for the whole address. */
    public static final int MAX_EMAIL_LOCAL_LENGTH = 64;
    public static final int MAX_EMAIL_LENGTH = 254;

    /**
     * An account label — a staff login, a till, a desk. The widest name rule: digits
     * are allowed because "Billing Counter 2" is how pharmacies name logins.
     */
    public static final Pattern ACCOUNT_NAME =
            Pattern.compile("^[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}\\s.,'’()/&-]*$");

    /** Presence of any letter — an account label made only of digits is not a name. */
    public static final Pattern CONTAINS_LETTER = Pattern.compile("\\p{L}");

    /** Any digit, used to tell "has numbers in it" apart from "has odd punctuation". */
    public static final Pattern CONTAINS_DIGIT = Pattern.compile("\\d");

    /** Longest person name accepted unless a field overrides it. */
    public static final int MAX_PERSON_NAME_LENGTH = 100;

    /** Trim, then collapse internal whitespace runs to a single space. */
    public static String normalizeName(String raw) {
        return raw == null ? null : raw.trim().replaceAll("\\s+", " ");
    }

    /**
     * Reduce a typed or pasted number to the bare 10-digit national number.
     *
     * <p>The country-code and trunk-zero strips are guarded by total length rather than
     * applied blindly, because "9198765432" is itself a valid mobile — a bare
     * {@code startsWith("91")} would turn a real number into an 8-digit one.
     */
    public static String normalizeMobile(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("\\D", "");
        if (digits.length() == 12 && digits.startsWith("91")) {
            digits = digits.substring(2);
        } else if (digits.length() == 11 && digits.startsWith("0")) {
            digits = digits.substring(1);
        }
        return digits;
    }
}
