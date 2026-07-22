package com.checkup.pharmacy.modules.migration.csv;

import com.checkup.pharmacy.modules.migration.dto.RowIssue;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Per-entity CSV row validation, ported from the old Node backend's
 * {@code validate*Row} functions (final version, commit 4744f25). Each method
 * appends {@link RowIssue}s to the caller-supplied list and returns {@code null}
 * when the row has a blocking error (missing the one truly-required field, or —
 * for inventory only — an unparseable expiry date).
 */
@Component
public class MigrationRowValidator {

    private static final int NEAR_EXPIRY_DAYS = 90;
    private static final Set<String> VALID_GST_RATES = Set.of("0", "5", "12", "18");
    private static final Pattern GSTIN_RE =
            Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$");
    private static final Pattern PHONE_RE = Pattern.compile("^(?:\\+91|91|0)?([6-9][0-9]{9})$");

    private final MigrationCsvParser csvParser;

    public MigrationRowValidator(MigrationCsvParser csvParser) {
        this.csvParser = csvParser;
    }

    public ValidatedInventoryRow validateInventoryRow(int row, Map<String, String> f, List<RowIssue> issues) {
        String medicineName = trimToNull(f.get("medicineName"));
        String batchNumber = trimToNull(f.get("batchNumber"));
        boolean hasError = false;

        if (medicineName == null) {
            issues.add(RowIssue.error(row, "medicineName", "Medicine name is required"));
            hasError = true;
        }
        if (batchNumber == null) {
            issues.add(RowIssue.error(row, "batchNumber", "Batch number is required"));
            hasError = true;
        }

        String expiryRaw = trimToNull(f.get("expiryDate"));
        Instant expiryDate = null;
        if (expiryRaw == null) {
            issues.add(RowIssue.error(row, "expiryDate", "Expiry date is required"));
            hasError = true;
        } else {
            expiryDate = csvParser.normaliseDate(expiryRaw, MigrationCsvParser.DateContext.EXPIRY);
            if (expiryDate == null) {
                issues.add(RowIssue.error(row, "expiryDate",
                        "Cannot parse expiry date \"" + expiryRaw + "\" — use DD/MM/YYYY, MM/YY, or YYYY-MM-DD"));
                hasError = true;
            } else {
                Instant now = Instant.now();
                if (expiryDate.isBefore(now)) {
                    issues.add(RowIssue.warning(row, "expiryDate", "Batch is already expired"));
                } else if (Duration.between(now, expiryDate).toDays() <= NEAR_EXPIRY_DAYS) {
                    long daysLeft = Duration.between(now, expiryDate).toDays();
                    issues.add(RowIssue.warning(row, "expiryDate", "Batch expires in " + daysLeft + " days (near expiry)"));
                }
            }
        }

        Integer quantity = parseInt(f.get("quantity"));
        if (quantity == null) {
            issues.add(RowIssue.error(row, "quantity", "Quantity is required"));
            hasError = true;
        } else if (quantity < 0) {
            issues.add(RowIssue.error(row, "quantity", "Quantity cannot be negative"));
            hasError = true;
        } else if (quantity == 0) {
            issues.add(RowIssue.warning(row, "quantity", "Row imported with zero stock"));
        }

        BigDecimal mrp = parseDecimal(f.get("mrp"));
        if (mrp == null) {
            issues.add(RowIssue.error(row, "mrp", "MRP is required"));
            hasError = true;
        } else if (mrp.signum() <= 0) {
            issues.add(RowIssue.error(row, "mrp", "MRP must be greater than zero"));
            hasError = true;
        }

        BigDecimal purchaseRate = parseDecimal(f.get("purchaseRate"));
        if (purchaseRate == null) {
            issues.add(RowIssue.error(row, "purchaseRate", "Purchase rate is required"));
            hasError = true;
        } else if (purchaseRate.signum() <= 0) {
            issues.add(RowIssue.error(row, "purchaseRate", "Purchase rate must be greater than zero"));
            hasError = true;
        } else if (mrp != null && purchaseRate.compareTo(mrp) > 0) {
            issues.add(RowIssue.warning(row, "purchaseRate", "Purchase rate is higher than MRP"));
        }

        String gstRaw = trimToNull(f.get("gstRate"));
        BigDecimal gstRate;
        if (gstRaw == null) {
            gstRate = new BigDecimal("12");
        } else if (!VALID_GST_RATES.contains(gstRaw.replaceAll("\\.0+$", ""))) {
            issues.add(RowIssue.warning(row, "gstRate", "Unrecognized GST rate \"" + gstRaw + "\" — defaulted to 12%"));
            gstRate = new BigDecimal("12");
        } else {
            gstRate = new BigDecimal(gstRaw);
        }

        if (hasError || expiryDate == null) {
            return null;
        }
        return new ValidatedInventoryRow(medicineName, batchNumber, expiryDate, quantity, mrp, purchaseRate, gstRate,
                trimToNull(f.get("manufacturer")), trimToNull(f.get("hsnCode")), parseInt(f.get("minimumStock")));
    }

    public ValidatedSupplierRow validateSupplierRow(int row, Map<String, String> f, List<RowIssue> issues) {
        String name = trimToNull(f.get("supplierName"));
        if (name == null) {
            issues.add(RowIssue.error(row, "supplierName", "Supplier name is required"));
            return null;
        }

        Integer creditDays = parseInt(f.get("creditDays"));
        if (f.get("creditDays") != null && !f.get("creditDays").isBlank() && (creditDays == null || creditDays < 0)) {
            issues.add(RowIssue.warning(row, "creditDays", "Invalid credit days \"" + f.get("creditDays") + "\" — ignored"));
            creditDays = null;
        }

        BigDecimal openingBalance = parseDecimal(f.get("openingBalance"));
        if (f.get("openingBalance") != null && !f.get("openingBalance").isBlank() && openingBalance == null) {
            issues.add(RowIssue.warning(row, "openingBalance", "Invalid opening balance \"" + f.get("openingBalance") + "\" — ignored"));
        }

        String gstin = trimToNull(f.get("gstin"));
        if (gstin != null) {
            gstin = gstin.toUpperCase(java.util.Locale.ROOT);
            if (!GSTIN_RE.matcher(gstin).matches()) {
                issues.add(RowIssue.warning(row, "gstin", "GSTIN \"" + gstin + "\" doesn't look valid — kept as entered"));
            }
        }

        String phone = normalizePhone(f.get("phone"), row, issues);

        return new ValidatedSupplierRow(name, gstin, trimToNull(f.get("dlNumber")), phone, trimToNull(f.get("email")),
                trimToNull(f.get("address")), trimToNull(f.get("city")), trimToNull(f.get("state")), creditDays,
                openingBalance);
    }

    public ValidatedCustomerRow validateCustomerRow(int row, Map<String, String> f, List<RowIssue> issues) {
        String name = trimToNull(f.get("customerName"));
        if (name == null) {
            issues.add(RowIssue.error(row, "customerName", "Customer name is required"));
            return null;
        }

        String dobRaw = trimToNull(f.get("dateOfBirth"));
        Instant dob = null;
        if (dobRaw != null) {
            dob = csvParser.normaliseDate(dobRaw, MigrationCsvParser.DateContext.DOB);
            if (dob == null) {
                issues.add(RowIssue.warning(row, "dateOfBirth", "Cannot parse date of birth \"" + dobRaw + "\" — left blank"));
            }
        }

        String phone = normalizePhone(f.get("phone"), row, issues);

        String gender = trimToNull(f.get("gender"));
        if (gender != null) {
            String upper = gender.toUpperCase(java.util.Locale.ROOT);
            gender = switch (upper) {
                case "M", "MALE" -> "Male";
                case "F", "FEMALE" -> "Female";
                case "OTHER" -> "Other";
                default -> gender;
            };
        }

        return new ValidatedCustomerRow(name, phone, trimToNull(f.get("email")), trimToNull(f.get("address")), dob,
                gender, parseDecimal(f.get("creditLimit")), parseDecimal(f.get("openingDue")),
                trimToNull(f.get("abhaNumber")), trimToNull(f.get("cardNumber")), trimToNull(f.get("notes")));
    }

    public ValidatedDoctorRow validateDoctorRow(int row, Map<String, String> f, List<RowIssue> issues) {
        String name = trimToNull(f.get("doctorName"));
        if (name == null) {
            issues.add(RowIssue.error(row, "doctorName", "Doctor name is required"));
            return null;
        }
        return new ValidatedDoctorRow(name, trimToNull(f.get("registrationNo")), trimToNull(f.get("specialty")),
                trimToNull(f.get("clinic")), trimToNull(f.get("phone")), trimToNull(f.get("email")));
    }

    private static String normalizePhone(String raw, int row, List<RowIssue> issues) {
        String phone = trimToNull(raw);
        if (phone == null) {
            return null;
        }
        var m = PHONE_RE.matcher(phone);
        if (m.matches()) {
            return m.group(1);
        }
        issues.add(RowIssue.warning(row, "phone", "Phone number \"" + phone + "\" doesn't look valid — kept as entered"));
        return phone;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static Integer parseInt(String s) {
        String t = trimToNull(s);
        if (t == null) {
            return null;
        }
        try {
            return Integer.parseInt(t.replaceAll("[,\\s]", ""));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static BigDecimal parseDecimal(String s) {
        String t = trimToNull(s);
        if (t == null) {
            return null;
        }
        try {
            return new BigDecimal(t.replaceAll("[,\\s]", ""));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
