package com.checkup.pharmacy.modules.migration.csv;

public record ValidatedDoctorRow(String name, String registrationNo, String specialty, String clinic, String phone,
                                 String email) {
}
