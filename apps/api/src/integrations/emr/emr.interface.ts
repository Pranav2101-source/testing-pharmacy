// Standard interface all EMR adapters must implement.
// Add new EMRs by creating a new adapter in a subdirectory.

export type EmrPatient = {
  id: string;
  name: string;
  phone?: string;
  age?: number;
  gender?: string;
};

export type EmrPrescription = {
  id: string;
  patientId: string;
  doctorName: string;
  date: Date;
  medicines: Array<{
    name: string;
    genericName?: string;
    dosage?: string;
    duration?: string;
    quantity?: number;
  }>;
};

export interface IEmrAdapter {
  getPatient(patientId: string): Promise<EmrPatient | null>;
  getPrescription(prescriptionId: string): Promise<EmrPrescription | null>;
  getPatientPrescriptions(patientId: string): Promise<EmrPrescription[]>;
}
