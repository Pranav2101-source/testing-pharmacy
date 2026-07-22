package com.checkup.pharmacy.modules.prescription.dto;

import java.time.Instant;
import java.util.List;

public record PrescriptionResponse(
        String id,
        String prescriptionNumber,
        DoctorRef doctor,
        String doctorName,
        String doctorRegNo,
        String doctorPhone,
        String patientName,
        Integer patientAge,
        String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        String status,
        String notes,
        List<Item> items,
        UploadRef upload,
        Instant createdAt,
        Instant updatedAt
) {
    public record DoctorRef(String id, String name, String registrationNo) {
    }

    public record Item(String id, String medicineName, String medicineId, String schedule, int quantity,
                       int dispensedQty, String dosage, String duration, String notes) {
    }

    public record UploadRef(String id, String fileName, String mimeType, String fileUrl) {
    }
}
