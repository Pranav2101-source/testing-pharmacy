import type { IEmrAdapter, EmrPatient, EmrPrescription } from "../emr.interface.js";

// Adapter for your own internal EMR system.
// Replace the fetch URLs with your actual EMR API endpoints.

export class InternalEmrAdapter implements IEmrAdapter {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`EMR request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async getPatient(patientId: string): Promise<EmrPatient | null> {
    try {
      return await this.request<EmrPatient>(`/patients/${patientId}`);
    } catch {
      return null;
    }
  }

  async getPrescription(prescriptionId: string): Promise<EmrPrescription | null> {
    try {
      return await this.request<EmrPrescription>(`/prescriptions/${prescriptionId}`);
    } catch {
      return null;
    }
  }

  async getPatientPrescriptions(patientId: string): Promise<EmrPrescription[]> {
    try {
      return await this.request<EmrPrescription[]>(`/patients/${patientId}/prescriptions`);
    } catch {
      return [];
    }
  }
}
