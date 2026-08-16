package com.checkup.pharmacy.common.tax;

import java.util.Arrays;
import java.util.Optional;

/**
 * The states and union territories a GSTIN can belong to, with their GST state codes.
 *
 * <p>WHY THIS IS AN ENUM AND NOT A FREE-TEXT FIELD
 *
 * <p>Whether a purchase attracts IGST or CGST+SGST is decided by comparing two state strings.
 * Left as free text, that comparison silently fails on anything but an exact match, and the
 * live data proved every way it can go wrong: one pharmacy had its state recorded as
 * {@code "cjd9949"}, another as {@code "karnataka"} against a GSTIN whose state code said
 * Chhattisgarh. A tax decision cannot rest on whether two people spelled a state the same way.
 *
 * <p>The first two digits of a GSTIN ARE the state code, so where a GSTIN exists the state is
 * derivable exactly rather than typed — see {@link #fromGstin}.
 */
public enum IndianState {

    JAMMU_AND_KASHMIR("01", "Jammu and Kashmir"),
    HIMACHAL_PRADESH("02", "Himachal Pradesh"),
    PUNJAB("03", "Punjab"),
    CHANDIGARH("04", "Chandigarh"),
    UTTARAKHAND("05", "Uttarakhand"),
    HARYANA("06", "Haryana"),
    DELHI("07", "Delhi"),
    RAJASTHAN("08", "Rajasthan"),
    UTTAR_PRADESH("09", "Uttar Pradesh"),
    BIHAR("10", "Bihar"),
    SIKKIM("11", "Sikkim"),
    ARUNACHAL_PRADESH("12", "Arunachal Pradesh"),
    NAGALAND("13", "Nagaland"),
    MANIPUR("14", "Manipur"),
    MIZORAM("15", "Mizoram"),
    TRIPURA("16", "Tripura"),
    MEGHALAYA("17", "Meghalaya"),
    ASSAM("18", "Assam"),
    WEST_BENGAL("19", "West Bengal"),
    JHARKHAND("20", "Jharkhand"),
    ODISHA("21", "Odisha"),
    CHHATTISGARH("22", "Chhattisgarh"),
    MADHYA_PRADESH("23", "Madhya Pradesh"),
    GUJARAT("24", "Gujarat"),
    DADRA_AND_NAGAR_HAVELI_AND_DAMAN_AND_DIU("26", "Dadra and Nagar Haveli and Daman and Diu"),
    MAHARASHTRA("27", "Maharashtra"),
    KARNATAKA("29", "Karnataka"),
    GOA("30", "Goa"),
    LAKSHADWEEP("31", "Lakshadweep"),
    KERALA("32", "Kerala"),
    TAMIL_NADU("33", "Tamil Nadu"),
    PUDUCHERRY("34", "Puducherry"),
    ANDAMAN_AND_NICOBAR_ISLANDS("35", "Andaman and Nicobar Islands"),
    TELANGANA("36", "Telangana"),
    ANDHRA_PRADESH("37", "Andhra Pradesh"),
    LADAKH("38", "Ladakh"),
    OTHER_TERRITORY("97", "Other Territory");

    private final String gstCode;
    private final String displayName;

    IndianState(String gstCode, String displayName) {
        this.gstCode = gstCode;
        this.displayName = displayName;
    }

    public String gstCode() {
        return gstCode;
    }

    public String displayName() {
        return displayName;
    }

    /**
     * Resolve a stored state string, tolerantly.
     *
     * <p>Deliberately forgiving about case, surrounding space and the separators inside a
     * name, because records written before this enum existed hold things like
     * {@code "karnataka"}, {@code "Tamilnadu"} and {@code "Jammu & Kashmir"}. Those are
     * renderings of a name, not different names, and treating them as unrecognised meant a
     * pharmacy in Tamil Nadu buying from a supplier in "Tamilnadu" was charged IGST on a
     * local purchase.
     *
     * <p>It is NOT forgiving about abbreviations or misspellings: accepting "TN" here would
     * mean accepting that two suppliers in the same state might not compare equal, which is
     * the whole failure this type exists to remove.
     *
     * <p>Normalisation is {@link TaxJurisdiction#canonicalKey}, shared so that resolving a
     * name and comparing two names can never disagree about what counts as the same place.
     */
    public static Optional<IndianState> fromName(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        String normalised = TaxJurisdiction.canonicalKey(value.trim());
        return Arrays.stream(values())
                .filter(s -> TaxJurisdiction.canonicalKey(s.displayName).equals(normalised))
                .findFirst();
    }

    /**
     * The state a GSTIN belongs to, read from its first two digits.
     *
     * <p>Authoritative where it applies: the code is assigned by the tax authority, not typed
     * by whoever created the record. Returns empty for anything that is not a plausible GSTIN
     * rather than guessing — the live data contains an 18-character "GSTIN", and inferring a
     * state from a malformed one would launder bad input into a tax decision.
     */
    public static Optional<IndianState> fromGstin(String gstin) {
        if (gstin == null || gstin.trim().length() != GSTIN_LENGTH) {
            return Optional.empty();
        }
        String code = gstin.trim().substring(0, 2);
        return Arrays.stream(values()).filter(s -> s.gstCode.equals(code)).findFirst();
    }

    /** A GSTIN is 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum. */
    public static final int GSTIN_LENGTH = 15;

    /**
     * Shape check only — 2 digits, a PAN, an entity digit, a letter, an alphanumeric check
     * character. Deliberately not a checksum validation: rejecting a real GSTIN because this
     * system got the checksum algorithm subtly wrong would be worse than accepting a
     * well-formed fake, which the tax portal will reject anyway.
     */
    public static final String GSTIN_PATTERN = "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$";
}
