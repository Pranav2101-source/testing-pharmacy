package com.checkup.pharmacy.modules.migration.csv;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Auto-detects which canonical field a raw CSV header most likely maps to, against
 * header conventions from Marg ERP/Busy/GoFrugal/RetailGraph/RedBook/Tally exports.
 * Ported byte-for-byte from the old Node backend's {@code migration.mapper.ts}
 * (final version, commit 4744f25) — the alias dictionary and scoring algorithm
 * below are not a fresh design, they're a faithful transcription.
 */
@Component
public class ColumnMapper {

    public record ColumnDetection(String csvHeader, String suggestedField, String confidence) {
    }

    // Declared before the static { } block below, which calls normalise() at class-init
    // time — Java initializes static fields/blocks in textual order, so these must come
    // first or normalise() would run against still-null Pattern fields.
    private static final Pattern NON_ALNUM = Pattern.compile("[^a-z0-9\\s]");
    private static final Pattern MULTI_SPACE = Pattern.compile("\\s+");
    private static final Pattern SEPARATORS = Pattern.compile("[_-]");

    private static final Map<String, List<String>> ALIASES = new LinkedHashMap<>();
    /** normalized alias -> canonical field, built once at class load. */
    private static final Map<String, String> REVERSE = new LinkedHashMap<>();
    /** canonical field -> its alias phrases, each pre-split into words, for scoring. */
    private static final Map<String, List<List<String>>> ALIAS_WORDS = new LinkedHashMap<>();

    static {
        put("medicineName", "medicine name", "item name", "product name", "drug name", "item description",
                "description", "medicine", "product", "item", "name", "particulars", "drug", "medicine product",
                "product description", "item code name", "salt name", "generic name", "trade name", "brand name");
        put("batchNumber", "batch no", "batch number", "batch", "lot no", "lot number", "lot", "batch no.",
                "batchno", "mfg batch");
        put("expiryDate", "expiry", "expiry date", "exp date", "expiry dt", "exp dt", "expiry date mm yy",
                "expiry mm yy", "use before", "best before");
        put("quantity", "qty", "quantity", "closing stock", "current qty", "available qty", "stock qty",
                "on hand", "current stock", "stock balance", "qty on hand", "opening qty");
        put("mrp", "mrp", "m r p", "retail price", "sale price", "selling price", "max retail price",
                "maximum retail price", "unit price", "price", "unit mrp", "pack price");
        put("purchaseRate", "purchase rate", "purchase price", "cost price", "ptr", "landing cost", "net rate",
                "purchase rate excl gst", "purchase cost", "p rate", "pur rate", "rate", "cost");
        put("manufacturer", "manufacturer", "company", "mfr", "mfg", "mfg name", "company name",
                "manufacturer name", "made by", "manufactured by", "mfr name");
        put("gstRate", "gst", "gst rate", "gst percent", "tax rate", "tax percent", "gst rate percent",
                "gst slab", "tax slab", "gst applicable");
        put("hsnCode", "hsn", "hsn code", "hsn sac", "hsn no", "hsn number", "hsn code no", "sac code");
        put("minimumStock", "minimum stock", "min stock", "reorder qty", "reorder level", "min qty",
                "safety stock", "reorder point");

        put("supplierName", "supplier name", "vendor name", "supplier", "vendor", "distributor name",
                "distributor", "creditor name");
        put("gstin", "gstin", "gst no", "gst number", "gst in", "gst registration", "gst reg no", "gstin no");
        put("dlNumber", "drug license", "dl no", "dl number", "drug licence", "drug license no", "d l no");
        put("phone", "phone", "mobile", "phone no", "mobile no", "contact no", "phone number", "mobile number",
                "contact number", "tel", "telephone");
        put("email", "email", "e mail", "email address");
        put("address", "address", "addr", "street", "street address");
        put("city", "city", "town", "district");
        put("state", "state", "province");
        put("creditDays", "credit days", "payment days", "credit period", "due days", "payment terms", "credit terms");
        put("openingBalance", "opening balance", "outstanding", "amount due", "payable", "opening due", "op balance");

        put("customerName", "customer name", "patient name", "customer", "client name", "member name");
        put("dateOfBirth", "dob", "date of birth", "birth date", "d o b", "birthdate", "date of birth dd mm yyyy");
        put("gender", "gender", "sex");
        put("creditLimit", "credit limit", "credit ceiling");
        put("openingDue", "opening due", "outstanding amount", "balance due", "amount outstanding", "receivable",
                "due amount");
        put("abhaNumber", "abha", "abha number", "abha id", "health id", "ipd no", "opd no", "uhid");
        put("cardNumber", "card number", "card no", "loyalty card", "membership no");
        put("notes", "notes", "remarks", "comment", "note");

        put("doctorName", "doctor name", "dr name", "physician name", "consultant name", "doctor", "dr");
        put("registrationNo", "reg no", "registration no", "mci no", "registration number", "doctor reg",
                "med reg no", "doctor registration");
        put("specialty", "specialty", "specialization", "specialisation", "dept", "department", "discipline");
        put("clinic", "clinic", "hospital", "clinic name", "hospital name", "practice", "facility");

        for (var entry : ALIASES.entrySet()) {
            List<List<String>> words = new ArrayList<>();
            for (String alias : entry.getValue()) {
                String normalised = normalise(alias);
                REVERSE.put(normalised, entry.getKey());
                words.add(Arrays.asList(normalised.split(" ")));
            }
            ALIAS_WORDS.put(entry.getKey(), words);
        }
    }

    private static void put(String canonical, String... aliases) {
        ALIASES.put(canonical, List.of(aliases));
    }

    public List<ColumnDetection> detectColumns(List<String> headers) {
        List<ColumnDetection> results = new ArrayList<>();
        for (String header : headers) {
            results.add(detectOne(header));
        }
        return results;
    }

    private ColumnDetection detectOne(String header) {
        String normalised = normalise(header);
        String exact = REVERSE.get(normalised);
        if (exact != null) {
            return new ColumnDetection(header, exact, "high");
        }

        List<String> headerWords = new ArrayList<>();
        for (String w : normalised.split(" ")) {
            if (w.length() >= 3) {
                headerWords.add(w);
            }
        }
        if (headerWords.isEmpty()) {
            return new ColumnDetection(header, null, "none");
        }

        String bestField = null;
        double bestScore = 0;
        for (var entry : ALIAS_WORDS.entrySet()) {
            for (List<String> aliasWords : entry.getValue()) {
                double score = wordScore(aliasWords, headerWords);
                if (score > bestScore) {
                    bestScore = score;
                    bestField = entry.getKey();
                }
            }
        }

        if (bestField == null || bestScore <= 0) {
            return new ColumnDetection(header, null, "none");
        }
        String confidence = bestScore >= 0.99 ? "high" : bestScore >= 0.5 ? "medium" : "low";
        return new ColumnDetection(header, bestField, confidence);
    }

    /** Jaccard-style coverage: a word matches if equal to, or a prefix of, the other. */
    private static double wordScore(List<String> aWords, List<String> bWords) {
        int matched = 0;
        for (String aw : aWords) {
            boolean hit = false;
            for (String bw : bWords) {
                if (bw.equals(aw) || bw.startsWith(aw) || aw.startsWith(bw)) {
                    hit = true;
                    break;
                }
            }
            if (hit) {
                matched++;
            }
        }
        return (double) matched / Math.max(aWords.size(), bWords.size());
    }

    private static String normalise(String s) {
        String lower = SEPARATORS.matcher(s.toLowerCase(java.util.Locale.ROOT)).replaceAll(" ");
        String stripped = NON_ALNUM.matcher(lower).replaceAll("");
        return MULTI_SPACE.matcher(stripped).replaceAll(" ").trim();
    }
}
