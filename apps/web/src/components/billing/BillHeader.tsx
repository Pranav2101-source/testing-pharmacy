"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Stethoscope, ChevronDown, FileText, ClipboardList, X, UserPlus, AlertTriangle, CheckCircle2, Plus, Loader2, Upload, ImageIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  isClean,
  normalizeIndianMobile,
  sanitizeProfessionalName,
  validateIndianMobile,
  validateProfessionalName,
} from "@pharmacy/utils";
import { cn } from "@/lib/utils";
import { useBillingStore } from "./useBillingStore";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";
import { DoctorQuickAddModal } from "@/components/doctors/DoctorQuickAddModal";
import type { DoctorRecord } from "@/components/doctors/DoctorQuickAddModal";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";

// Computed once per session — bill date never changes mid-session
const TODAY_LABEL = format(new Date(), "dd/MM/yyyy");

/** Inline message under a prescription field. Renders nothing when the field is fine. */
function RxFieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-[11px] text-red-600 font-medium mt-1">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />{message}
    </p>
  );
}

interface DoctorHint { id: string; name: string; specialty: string | null; registrationNo: string | null; }
interface RxHint {
  id: string;
  prescriptionNumber: string;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  status: string;
  validUntil: string | null;
  items: { id: string; medicineName: string; schedule: string | null; quantity: number; dosage: string | null }[];
}
type DropdownPos = { top: number; left: number; width: number };

// Full prescription detail (returned by GET /prescriptions/:id)
interface RxDetail {
  id: string; prescriptionNumber: string; status: string;
  patientName: string; patientAge: number | null; patientPhone: string | null; patientGender: string | null;
  doctorName: string; doctorRegNo: string | null;
  doctor: { id: string; name: string; registrationNo: string | null } | null;
  prescribedDate: string | null; validUntil: string | null; notes: string | null;
  upload: { id: string; fileName: string; mimeType: string } | null;
  items: { id: string; medicineName: string; schedule: string | null; quantity: number; dosage: string | null; duration: string | null }[];
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    "bg-green-100 text-green-700",
  PARTIAL:   "bg-blue-100 text-blue-700",
  DISPENSED: "bg-slate-100 text-slate-600",
  EXPIRED:   "bg-red-100 text-red-600",
  CANCELLED: "bg-rose-100 text-rose-700",
};
const RX_SCHEDULE_BADGE: Record<string, string> = {
  H:  "bg-amber-100 text-amber-700", H1: "bg-orange-100 text-orange-700", X: "bg-red-100 text-red-600",
};

function RxPreviewModal({
  rxHint,
  onClose,
  onConfirm,
  onEdit,
}: {
  rxHint: RxHint;
  onClose:   () => void;
  onConfirm: () => void;
  onEdit:    (detail: RxDetail) => void;
}) {
  const [detail, setDetail] = useState<RxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewingFile, setViewingFile] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get<{ data: RxDetail }>(`/prescriptions/${rxHint.id}`)
      .then(r => setDetail(r.data.data))
      .catch(() => toast.error("Could not load prescription details"))
      .finally(() => setLoading(false));
  }, [rxHint.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openFile() {
    if (!detail?.upload) return;
    setViewingFile(true);
    try {
      const { data } = await api.get<{ data: { signedUrl: string | null } }>(`/uploads/${detail.upload.id}/signed-url`);
      if (data.data.signedUrl) window.open(data.data.signedUrl, "_blank", "noopener,noreferrer");
      else toast.error("Could not generate a view link.");
    } catch { toast.error("Failed to open file"); }
    finally { setViewingFile(false); }
  }

  const rx = detail;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 12  }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="bg-slate-800 px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">Prescription Preview</p>
            <div className="flex items-center gap-2 mt-0.5">
              <h3 className="text-white text-[17px] font-bold leading-tight">{rxHint.prescriptionNumber}</h3>
              {rxHint.status && (
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full leading-none", STATUS_BADGE[rxHint.status] ?? "bg-slate-100 text-slate-600")}>
                  {rxHint.status}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-240px)]">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          )}

          {!loading && rx && (
            <>
              {/* Patient + Doctor */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Patient</p>
                  <p className="text-[14px] font-bold text-slate-800">{rx.patientName}</p>
                  {rx.patientAge && <p className="text-[12px] text-slate-500 mt-0.5">{rx.patientAge} yrs {rx.patientGender ? `· ${rx.patientGender}` : ""}</p>}
                  {rx.patientPhone && <p className="text-[12px] text-slate-500 mt-0.5">{rx.patientPhone}</p>}
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Doctor</p>
                  <p className="text-[14px] font-bold text-slate-800">{rx.doctorName}</p>
                  {rx.doctorRegNo && <p className="text-[12px] text-slate-500 mt-0.5">{rx.doctorRegNo}</p>}
                </div>
              </div>

              {/* Dates */}
              {(rx.prescribedDate || rx.validUntil) && (
                <div className="flex items-center gap-4 text-[12px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2.5">
                  {rx.prescribedDate && (
                    <span>Prescribed: <strong className="text-slate-700">{format(new Date(rx.prescribedDate), "dd MMM yyyy")}</strong></span>
                  )}
                  {rx.validUntil && (
                    <span>Valid till: <strong className={cn("text-slate-700", new Date(rx.validUntil) < new Date() ? "text-red-600" : "")}>
                      {format(new Date(rx.validUntil), "dd MMM yyyy")}
                    </strong></span>
                  )}
                </div>
              )}

              {/* Medicines */}
              {rx.items.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                    Medicines ({rx.items.length})
                  </p>
                  <div className="space-y-1.5">
                    {rx.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2.5 bg-slate-50 rounded-lg px-3 py-2">
                        {item.schedule && RX_SCHEDULE_BADGE[item.schedule.toUpperCase()] && (
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none flex-shrink-0", RX_SCHEDULE_BADGE[item.schedule.toUpperCase()])}>
                            Sch {item.schedule.toUpperCase()}
                          </span>
                        )}
                        <span className="text-[13px] font-semibold text-slate-800 flex-1 min-w-0 truncate">{item.medicineName}</span>
                        <span className="text-[12px] text-slate-500 flex-shrink-0">×{item.quantity}</span>
                        {item.dosage && <span className="text-[11px] text-slate-400 flex-shrink-0 truncate max-w-[100px]">{item.dosage}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence */}
              {rx.upload && (
                <button
                  type="button"
                  onClick={openFile}
                  disabled={viewingFile}
                  className="w-full flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 hover:bg-blue-100 transition-colors disabled:opacity-60"
                >
                  {viewingFile ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" /> : <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  <span className="text-[13px] font-semibold text-blue-700 flex-1 text-left truncate">{rx.upload.fileName}</span>
                  <span className="text-[11px] text-blue-400 flex-shrink-0">View ↗</span>
                </button>
              )}

              {/* Notes */}
              {rx.notes && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-[13px] text-amber-900">{rx.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => rx && onEdit(rx)}
            disabled={loading || !rx || rx.status === "CANCELLED" || rx.status === "DISPENSED" || rx.status === "PARTIAL"}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-30"
          >
            <FileText className="w-3.5 h-3.5" /> Edit Prescription
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold transition-colors shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4" /> Confirm & Link
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

// ── Quick‑create prescription form (launched from Rx combobox) ────────────────
type QuickDrug = { medicineName: string; schedule: string; quantity: string; dosage: string };
type QuickForm = {
  doctor:        { name: string; id: string };
  patientName:   string;
  patientAge:    string;
  patientPhone:  string;
  patientGender: string;
  prescribedDate: string;
  validUntil:    string;
  notes:         string;
  drugs:         QuickDrug[];
};

function QuickPrescriptionModal({
  initialPatientName,
  prefilledDrugs,
  editRx,
  onClose,
  onCreated,
}: {
  initialPatientName: string;
  prefilledDrugs: { medicineName: string; schedule: string | null }[];
  editRx?: RxDetail;
  onClose: () => void;
  onCreated: (rxNumber: string, rxId: string) => void;
}) {
  const isEdit = !!editRx;
  const today  = format(new Date(), "yyyy-MM-dd");
  const [form, setForm] = useState<QuickForm>(() => {
    if (editRx) return {
      doctor:         { name: editRx.doctorName, id: editRx.doctor?.id ?? "" },
      patientName:    editRx.patientName,
      patientAge:     editRx.patientAge != null ? String(editRx.patientAge) : "",
      patientPhone:   editRx.patientPhone ?? "",
      patientGender:  editRx.patientGender ?? "",
      prescribedDate: editRx.prescribedDate ? format(new Date(editRx.prescribedDate), "yyyy-MM-dd") : today,
      validUntil:     editRx.validUntil     ? format(new Date(editRx.validUntil),     "yyyy-MM-dd") : "",
      notes:          editRx.notes ?? "",
      drugs: editRx.items.map(i => ({
        medicineName: i.medicineName,
        schedule:     i.schedule ?? "",
        quantity:     String(i.quantity),
        dosage:       i.dosage ?? "",
      })),
    };
    return {
      doctor:         { name: "", id: "" },
      patientName:    initialPatientName,
      patientAge:     "",
      patientPhone:   "",
      patientGender:  "",
      prescribedDate: today,
      validUntil:     "",
      notes:          "",
      drugs: prefilledDrugs.length > 0
        ? prefilledDrugs.map(d => ({ medicineName: d.medicineName, schedule: d.schedule ?? "", quantity: "1", dosage: "" }))
        : [{ medicineName: "", schedule: "", quantity: "1", dosage: "" }],
    };
  });
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [uploadId,   setUploadId]   = useState<string | null>(null);
  const [uploadMeta, setUploadMeta] = useState<{ fileName: string; signedUrl: string; mimeType: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast   = useToast();
  const qc      = useQueryClient();
  const [rxErrors, setRxErrors] = useState<{ patientName?: string | null; patientPhone?: string | null }>({});

  /** Set a validated field and drop its complaint as soon as it is being corrected. */
  function setPatientField(key: "patientName" | "patientPhone", value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setRxErrors(e => (e[key] ? { ...e, [key]: null } : e));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ data: { id: string; fileName: string; signedUrl: string; mimeType: string } }>(
        "/uploads/prescription", fd,
      );
      setUploadId(data.data.id);
      setUploadMeta({ fileName: data.data.fileName, signedUrl: data.data.signedUrl ?? "", mimeType: data.data.mimeType });
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const set = <K extends keyof QuickForm>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  function updateDrug(i: number, k: keyof QuickDrug, v: string) {
    setForm(f => ({ ...f, drugs: f.drugs.map((d, j) => j === i ? { ...d, [k]: v } : d) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const doctorProblem = validateProfessionalName(form.doctor.name, { label: "Doctor name" });
    if (doctorProblem) { toast.error(doctorProblem); return; }

    // The doctor's name goes through the wider professional rule so a speciality in
    // brackets survives; the patient's goes through the narrow one.
    const found = {
      // Professional rule, matching @ProfessionalName on the DTO: digits stay blocked,
      // but "Ram Kumar (S/O Shyam)" — how a counter tells two same-named patients
      // apart — is not rejected.
      patientName:  validateProfessionalName(form.patientName, { label: "Patient name", maxLength: 200 }),
      patientPhone: validateIndianMobile(form.patientPhone, { label: "Phone", required: false }),
    };
    setRxErrors(found);
    if (!isClean(found)) {
      toast.error(found.patientName ?? found.patientPhone ?? "Please correct the highlighted fields");
      return;
    }

    if (form.drugs.every(d => !d.medicineName.trim())) { toast.error("Add at least one medicine"); return; }
    setSaving(true);
    try {
      const payload = {
        doctorId:       form.doctor.id  || undefined,
        doctorName:     form.doctor.name.trim(),
        patientName:    form.patientName.trim(),
        patientAge:     form.patientAge   ? parseInt(form.patientAge, 10) : undefined,
        patientPhone:   normalizeIndianMobile(form.patientPhone) || undefined,
        patientGender:  form.patientGender        || undefined,
        prescribedDate: form.prescribedDate ? `${form.prescribedDate}T00:00:00.000Z` : undefined,
        validUntil:     form.validUntil     ? `${form.validUntil}T00:00:00.000Z`     : undefined,
        notes:          form.notes.trim()   || undefined,
        items: form.drugs
          .filter(d => d.medicineName.trim())
          .map(d => ({
            medicineName: d.medicineName.trim(),
            schedule:     d.schedule || undefined,
            quantity:     parseInt(d.quantity, 10) || 1,
            dosage:       d.dosage.trim() || undefined,
          })),
      };
      const { data } = isEdit
        ? await api.patch<{ data: { id: string; prescriptionNumber: string } }>(`/prescriptions/${editRx!.id}`, payload)
        : await api.post<{ data: { id: string; prescriptionNumber: string } }>("/prescriptions", { ...payload, uploadId: uploadId || undefined });
      toast.success(`${data.data.prescriptionNumber} ${isEdit ? "updated" : "created"} and linked`);
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      onCreated(data.data.prescriptionNumber, data.data.id);
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to create prescription"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 12  }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="bg-blue-700 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-[10px] font-bold tracking-widest uppercase">{isEdit ? "Edit Prescription" : "New Prescription"}</p>
            <h3 className="text-white text-[16px] font-bold leading-tight">{isEdit ? editRx!.prescriptionNumber : "Record Prescription"}</h3>
          </div>
          <button onClick={onClose} className="text-blue-300 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">

          {/* Doctor */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Doctor *</label>
            <DoctorCombobox
              value={form.doctor.name}
              onChange={(name, doctorId) => setForm(f => ({ ...f, doctor: { name, id: doctorId ?? "" } }))}
            />
          </div>

          {/* Patient */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Patient Name *</label>
              <input
                value={form.patientName}
                // Digits and symbols never make it into the field, so a prescription
                // cannot be recorded against "Ram 123".
                onChange={(e) => setPatientField("patientName", sanitizeProfessionalName(e.target.value))}
                placeholder="Full name"
                className={cn(
                  "w-full border rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none transition-colors",
                  rxErrors.patientName ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400",
                )}
              />
              <RxFieldError message={rxErrors.patientName} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Age</label>
              <input value={form.patientAge} onChange={set("patientAge")} type="number" min="0" max="150" placeholder="Years"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:border-blue-400 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Phone</label>
              <input value={form.patientPhone} type="tel" inputMode="numeric" placeholder="98765 43210"
                onChange={(e) => setPatientField("patientPhone", normalizeIndianMobile(e.target.value))}
                className={cn(
                  "w-full border rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none transition-colors",
                  rxErrors.patientPhone ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400",
                )} />
              <RxFieldError message={rxErrors.patientPhone} />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Prescribed Date</label>
              <input type="date" value={form.prescribedDate} onChange={set("prescribedDate")}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Valid Until</label>
              <input type="date" value={form.validUntil} onChange={set("validUntil")}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400 transition-colors" />
            </div>
          </div>

          {/* Drug rows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Medicines</label>
              <button type="button" onClick={() => setForm(f => ({ ...f, drugs: [...f.drugs, { medicineName: "", schedule: "", quantity: "1", dosage: "" }] }))}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors">
                <Plus className="w-3 h-3" /> Add Row
              </button>
            </div>
            <div className="space-y-2">
              {form.drugs.map((drug, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_72px_60px_auto] gap-2 items-center">
                  <input value={drug.medicineName} onChange={e => updateDrug(idx, "medicineName", e.target.value)}
                    placeholder="Medicine name"
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] placeholder-slate-400 focus:outline-none focus:border-blue-400 transition-colors" />
                  <select value={drug.schedule} onChange={e => updateDrug(idx, "schedule", e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] text-slate-700 focus:outline-none focus:border-blue-400 transition-colors">
                    <option value="">Sch.</option>
                    <option value="H">H</option>
                    <option value="H1">H1</option>
                    <option value="X">X</option>
                    <option value="G">G</option>
                    <option value="OTC">OTC</option>
                  </select>
                  <input value={drug.quantity} onChange={e => updateDrug(idx, "quantity", e.target.value)}
                    type="number" min="1" placeholder="Qty"
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] placeholder-slate-400 focus:outline-none focus:border-blue-400 transition-colors" />
                  <button type="button" onClick={() => setForm(f => ({ ...f, drugs: f.drugs.filter((_, i) => i !== idx) }))}
                    disabled={form.drugs.length === 1}
                    className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-30 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Upload prescription scan */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <Upload className="w-3 h-3" /> Prescription Scan (optional)
            </label>
            {uploadMeta ? (
              <div className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-4 py-3">
                {uploadMeta.mimeType.startsWith("image/") ? (
                  <img src={uploadMeta.signedUrl} alt="Prescription" className="w-12 h-12 rounded-lg object-cover border border-green-200 flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-white border border-green-200 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-green-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{uploadMeta.fileName}</p>
                  <p className="text-[11px] text-green-600 font-medium mt-0.5">Uploaded</p>
                </div>
                <button type="button" onClick={() => { setUploadId(null); setUploadMeta(null); }}
                  className="text-slate-400 hover:text-red-500 transition-colors p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className={cn(
                "flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors",
                uploading ? "border-blue-300 bg-blue-50 cursor-wait" : "border-slate-200 hover:border-blue-400 hover:bg-blue-50",
              )}>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only" onChange={handleFile} disabled={uploading} />
                {uploading
                  ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  : <ImageIcon className="w-5 h-5 text-slate-400 flex-shrink-0" />}
                <span className="text-[12px] text-slate-500">
                  {uploading ? "Uploading…" : "Click to attach scan / PDF"}
                </span>
              </label>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Internal notes"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:border-blue-400 resize-none transition-colors" />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="text-[13px] font-semibold text-slate-500 hover:text-slate-700 transition-colors px-4 py-2">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold transition-colors disabled:opacity-60 shadow-sm">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? "Save & Link Rx" : "Create & Link Rx"}
            </button>
          </div>

        </form>
      </motion.div>
    </div>,
    document.body,
  );
}

function DoctorCombobox({ value, onChange }: { value: string; onChange: (name: string, doctorId?: string) => void }) {
  const [query,     setQuery]     = useState(value);
  const [open,      setOpen]      = useState(false);
  const [hints,     setHints]     = useState<DoctorHint[]>([]);
  const [searched,  setSearched]  = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos,       setPos]       = useState<DropdownPos>({ top: 0, left: 0, width: 260 });
  const anchorRef  = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef     = useRef<number | null>(null);
  const queryClient = useQueryClient();
  // Always-current query text, read inside the debounced fetch below to tell a
  // response that is still relevant apart from one answering a search the user has
  // since typed past or cleared.
  const queryRef   = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  useEffect(() => { setQuery(value); }, [value]);

  const recalc = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 280) });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, recalc]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Qualifications and specialities stay ("Dr. Sharma (Ortho)"); digits and stray
    // symbols are dropped. A registration number has its own field on the doctor
    // record, and typing one in here used to save a doctor called "Dr Rao 12345".
    const v = sanitizeProfessionalName(e.target.value);
    setQuery(v);
    onChange(v, "");   // free-text: no doctorId
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length < 1) { setHints([]); setSearched(false); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        // Cached 30s by search term — retyping a name already searched this session
        // (backspace-and-retype, tabbing away and back) is served from cache instead
        // of hitting /doctors again, and a second search in flight for the same term
        // shares that one request rather than duplicating it.
        const list = await queryClient.fetchQuery({
          queryKey: ["doctor-search", v],
          queryFn: () => api.get<{ data: DoctorHint[] }>(`/doctors?search=${encodeURIComponent(v)}&limit=6`)
            .then((r) => r.data.data ?? []),
          staleTime: 30_000,
        });
        // The user may have kept typing (or cleared the field) while this was in
        // flight — a slower older request landing after a newer one already updated
        // the dropdown would otherwise overwrite it with results for text no longer
        // in the box.
        if (v !== queryRef.current) return;
        setHints(list);
        setSearched(true);
        setOpen(true);   // always open after a search so "no results" is visible
        setActiveIndex(0);
        recalc();
      } catch {
        if (v === queryRef.current) { setHints([]); setSearched(false); setOpen(false); }
      }
    }, 220);
  }

  function pick(d: DoctorHint) {
    onChange(d.name, d.id);   // pass id so the FK is stored
    setQuery(d.name);
    setOpen(false);
  }

  function clear() {
    onChange("", "");          // clear both name and id
    setQuery("");
    setHints([]);
    setSearched(false);
    setOpen(false);
  }

  // totalRows includes the trailing "Add to Doctor Master" row, always present once open.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    const totalRows = hints.length + 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, totalRows - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < hints.length) { const d = hints[activeIndex]; if (d) pick(d); }
      else { setOpen(false); setShowModal(true); }
    } else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <>
      <div ref={anchorRef} className="relative flex items-center gap-1 w-full">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (hints.length > 0) { setOpen(true); recalc(); } }}
          placeholder="Name / Lic No."
          autoComplete="off"
          className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropRef}
              key="doctor-dropdown"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.13, ease: "easeOut" }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              {hints.length === 0 && searched && (
                <div className="px-4 py-2.5 text-[12px] text-slate-400 border-b border-slate-50">
                  No doctors found for &ldquo;{query}&rdquo;
                </div>
              )}
              {hints.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(d); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50",
                    activeIndex === i ? "bg-blue-50" : "hover:bg-blue-50",
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0">
                    {d.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{d.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {d.specialty && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded-full leading-none">
                          {d.specialty}
                        </span>
                      )}
                      {d.registrationNo && (
                        <span className="text-[10px] text-slate-400">#{d.registrationNo}</span>
                      )}
                    </div>
                  </div>
                  {activeIndex === i && (
                    <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">↵</span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); setShowModal(true); }}
                onMouseEnter={() => setActiveIndex(hints.length)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  activeIndex === hints.length ? "bg-blue-50" : "hover:bg-slate-50",
                )}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-blue-700">Add to Doctor Master</p>
                  <p className="text-[11px] text-slate-400">Save doctor details for future prescriptions.</p>
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {showModal && (
        <DoctorQuickAddModal
          initialName={query}
          onClose={() => setShowModal(false)}
          onSaved={(saved: DoctorRecord) => {
            onChange(saved.name, saved.id);
            setQuery(saved.name);
            setShowModal(false);
          }}
        />
      )}
    </>
  );
}

function PrescriptionCombobox({
  displayValue,
  onChange,
  placeholder = "Search Rx / patient",
  onNewPrescription,
  onPreviewSelect,
}: {
  displayValue: string;
  onChange: (prescriptionNumber: string, prescriptionId: string) => void;
  placeholder?: string;
  onNewPrescription?: (query: string) => void;
  onPreviewSelect?: (rx: RxHint) => void;
}) {
  const [query,    setQuery]    = useState(displayValue);
  const [open,     setOpen]     = useState(false);
  const [hints,    setHints]    = useState<RxHint[]>([]);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos,      setPos]      = useState<DropdownPos>({ top: 0, left: 0, width: 320 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef    = useRef<number | null>(null);
  const queryClient = useQueryClient();
  // Always-current query text — same guard as DoctorCombobox, so a slow response to
  // an earlier search can't land after a newer one and overwrite it.
  const queryRef  = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  useEffect(() => { setQuery(displayValue); }, [displayValue]);

  const recalc = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 320) });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, recalc]);

  // Close + restore displayed value when the user clicks away without selecting
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setOpen(false);
        setQuery(displayValue); // restore to last confirmed value
        setHints([]);
        setSearched(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [displayValue]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length < 1) {
      setHints([]);
      setSearched(false);
      setOpen(false);
      // User cleared the input manually — treat as "remove link"
      if (displayValue) onChange("", "");
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        // Same caching + guard as DoctorCombobox above.
        const list = await queryClient.fetchQuery({
          queryKey: ["rx-search", v],
          queryFn: () => api.get<{ data: { items: RxHint[] } }>(`/prescriptions?status=ACTIVE&search=${encodeURIComponent(v)}&limit=6`)
            .then((r) => r.data.data?.items ?? []),
          staleTime: 30_000,
        });
        if (v !== queryRef.current) return;
        setHints(list);
        setSearched(true);
        setOpen(true);
        setActiveIndex(0);
        recalc();
      } catch {
        if (v === queryRef.current) { setHints([]); setSearched(false); setOpen(false); }
      }
    }, 220);
  }

  // The trailing "New Prescription" row only exists once a search has actually run
  // (searched && onNewPrescription) — unlike Doctor's always-present trailing row.
  const hasNewRow = searched && !!onNewPrescription;
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    const totalRows = hints.length + (hasNewRow ? 1 : 0);
    if (totalRows === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, totalRows - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < hints.length) { const rx = hints[activeIndex]; if (rx) pick(rx); }
      else if (hasNewRow) { setOpen(false); onNewPrescription!(query); }
    } else if (e.key === "Escape") { setOpen(false); }
  }

  function pick(rx: RxHint) {
    setOpen(false);
    if (onPreviewSelect) {
      // Don't set query yet — wait for the user to confirm in the preview modal.
      // displayValue (from the store) will sync the input once confirmed.
      onPreviewSelect(rx);
    } else {
      onChange(rx.prescriptionNumber, rx.id);
      setQuery(rx.prescriptionNumber);
    }
  }

  function clear() {
    onChange("", "");
    setQuery("");
    setHints([]);
    setSearched(false);
    setOpen(false);
  }

  return (
    <>
      <div ref={anchorRef} className="relative flex items-center gap-1 w-full">
        <input
          type="text"
          data-rx-search-input
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (hints.length > 0) { setOpen(true); recalc(); } }}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropRef}
              key="rx-dropdown"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.13, ease: "easeOut" }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Results */}
              {hints.map((rx, i) => (
                <button
                  key={rx.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(rx); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-b-0",
                    activeIndex === i ? "bg-blue-50" : "hover:bg-blue-50",
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0 mt-0.5">
                    Rx
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[13px] font-bold text-slate-800">{rx.prescriptionNumber}</p>
                      <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full leading-none">
                        {rx.status}
                      </span>
                      {rx.items?.length > 0 && (
                        <span className="text-[10px] text-slate-400">{rx.items.length} med{rx.items.length !== 1 ? "s" : ""}</span>
                      )}
                      {activeIndex === i && (
                        <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide leading-none">↵</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-700 font-medium truncate mt-0.5">
                      {rx.patientName}{rx.patientPhone ? ` · ${rx.patientPhone}` : ""}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {rx.doctorName}
                      {rx.validUntil && ` · Valid till ${format(new Date(rx.validUntil), "dd MMM yy")}`}
                    </p>
                  </div>
                </button>
              ))}

              {/* No results state */}
              {hints.length === 0 && searched && (
                <div className="px-4 py-3 text-[12px] text-slate-400 border-b border-slate-50">
                  No active prescriptions found for &ldquo;{query}&rdquo;
                </div>
              )}

              {/* Create new prescription */}
              {hasNewRow && onNewPrescription && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setOpen(false); onNewPrescription(query); }}
                  onMouseEnter={() => setActiveIndex(hints.length)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                    activeIndex === hints.length ? "bg-blue-50" : "hover:bg-blue-50",
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-blue-700">New Prescription</p>
                    <p className="text-[11px] text-slate-400">
                      {query.trim() ? `Create for "${query}"` : "Record a new prescription"}
                    </p>
                  </div>
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

const BILLING_FOR_OPTIONS = ["Self", "Counter", "Credit"] as const;

const CONTROLLED = new Set(["H", "H1", "X"]);

const SCHEDULE_BADGE: Record<string, string> = {
  H:  "bg-amber-100 text-amber-700 border border-amber-200",
  H1: "bg-orange-100 text-orange-700 border border-orange-200",
  X:  "bg-red-100 text-red-600 border border-red-200",
};

function Divider() {
  return <div className="w-px self-stretch bg-slate-200 flex-shrink-0" />;
}

export function BillHeader() {
  const paymentStatus      = useBillingStore((s) => s.meta.paymentStatus);
  const paymentMode        = useBillingStore((s) => s.meta.paymentMode);
  const customerId         = useBillingStore((s) => s.meta.customerId);
  const doctorName         = useBillingStore((s) => s.meta.doctorName);
  const prescriptionNumber = useBillingStore((s) => s.meta.prescriptionNumber);
  const prescriptionId     = useBillingStore((s) => s.meta.prescriptionId);
  const items              = useBillingStore((s) => s.items);
  const setMeta            = useBillingStore((s) => s.setMeta);

  const [showQuickCreate,  setShowQuickCreate]  = useState(false);
  const [quickCreateQuery, setQuickCreateQuery] = useState("");
  const [rxPreview,        setRxPreview]        = useState<RxHint | null>(null);
  const [editRxDetail,     setEditRxDetail]     = useState<RxDetail | null>(null);

  const controlledSchedules = [...new Set(
    items.map((i) => (i.schedule ?? "").toUpperCase()).filter((s) => CONTROLLED.has(s)),
  )];
  const rxMissing      = controlledSchedules.length > 0 && !prescriptionId;
  const rxLinked       = controlledSchedules.length > 0 && !!prescriptionId;
  const controlledItems = items.filter((i) => CONTROLLED.has((i.schedule ?? "").toUpperCase()));

  function handleDoctorChange(name: string, doctorId?: string) {
    setMeta({ doctorName: name, doctorId: doctorId ?? "" });
  }

  function handleRxChange(rxNumber: string, rxId: string) {
    setMeta({ prescriptionNumber: rxNumber, prescriptionId: rxId });
  }

  function handleNewPrescription(query: string) {
    setQuickCreateQuery(query);
    setShowQuickCreate(true);
  }

  return (
    <>
    <div
      className="flex items-stretch border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto no-scrollbar"
      style={{ minHeight: "var(--header-height, 60px)", maxHeight: "var(--header-height, 60px)" }}
    >

      {/* Bill Date — neutral, understated */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[156px] bg-slate-50 border-r border-slate-200">
        <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Bill Date
          </p>
          <span className="text-[14px] font-bold text-slate-800 tabnum leading-none">
            {TODAY_LABEL}
          </span>
        </div>
      </div>

      {/* Customer — visually dominant; this is the primary first action */}
      <div className="flex items-center px-3.5 py-2 flex-1 min-w-[280px] relative">
        <CustomerSearchCombobox />
      </div>

      <Divider />

      {/* Billing For */}
      <div className="flex items-center px-4 py-2 flex-shrink-0 min-w-[140px]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Billing for
          </p>
          <div className="relative flex items-center">
            <select
              value={
                paymentStatus === "PENDING" ? "Credit" :
                customerId                  ? "Self"   : "Counter"
              }
              onChange={(e) => {
                // Mode and status are set together, never apart.
                //
                // This control used to set paymentStatus alone. Picking "Credit" while
                // the tender bar sat on CASH produced a bill that was PENDING but filed
                // as a cash sale, and every credit safeguard is keyed off the mode: no
                // customer was required, no credit limit was checked, and nothing was
                // ever added to what the customer owed. The stock left the shelf and the
                // debt belonged to nobody. Picking "Credit" here is now exactly the same
                // action as the Credit button on the tender bar (Alt+4).
                //
                // "Insurance" is gone with it. It only ever meant PARTIAL with no record
                // of what had been collected, which is the same trap wearing a different
                // label; a genuinely part-paid bill is now entered through the split
                // dialog (F7), which records each leg.
                const choice = e.target.value;
                const patch: Parameters<typeof setMeta>[0] = choice === "Credit"
                  ? { paymentMode: "CREDIT", paymentStatus: "PENDING", tenders: [] }
                  : { paymentStatus: "PAID", tenders: [], ...(paymentMode === "CREDIT" ? { paymentMode: "CASH" as const } : {}) };
                if (choice === "Counter") {
                  patch.customerId              = "";
                  patch.customerName            = "";
                  patch.customerPhone           = "";
                  patch.customerAddress         = "";
                  patch.abha                    = "";
                  patch.customerDefaultDiscount = 0;
                  patch.billDiscountPct         = 0;
                }
                setMeta(patch);
              }}
              className="text-[13px] font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer appearance-none pr-4 leading-none"
            >
              {BILLING_FOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none absolute right-0" />
          </div>
        </div>
      </div>

      <Divider />

      {/* Doctor */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-1 min-w-[180px] input-glow glow-focus">
        <Stethoscope className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Doctor
          </p>
          <DoctorCombobox
            value={doctorName}
            onChange={handleDoctorChange}
          />
        </div>
      </div>

      <Divider />

      {/* Prescription / Rx No. */}
      <div
        data-rx-field
        className={cn(
          "flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[220px] input-glow glow-focus transition-colors duration-200",
          rxMissing && "bg-amber-50/70 border-l-2 !border-l-amber-400",
          rxLinked  && "bg-green-50/50  border-l-2 !border-l-green-400",
        )}
      >
        {rxMissing
          ? <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 animate-pulse" strokeWidth={2} />
          : rxLinked
            ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" strokeWidth={2} />
            : <ClipboardList className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        }
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-widest leading-none",
                rxMissing ? "text-amber-600" : rxLinked ? "text-green-600" : "text-slate-400",
              )}
            >
              {rxMissing ? "Rx Required" : "Rx No."}
            </p>
            {rxMissing && controlledSchedules.map((s) => (
              <span
                key={s}
                className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none", SCHEDULE_BADGE[s] ?? "bg-slate-100 text-slate-600")}
              >
                Sch {s}
              </span>
            ))}
            {rxLinked && (
              <span className="text-[10px] font-bold text-green-500 leading-none">✓ Linked</span>
            )}
          </div>
          <PrescriptionCombobox
            displayValue={prescriptionNumber}
            onChange={handleRxChange}
            placeholder={rxMissing ? "Link prescription..." : "Search Rx / patient"}
            onNewPrescription={handleNewPrescription}
            onPreviewSelect={(rx) => setRxPreview(rx)}
          />
        </div>
      </div>

    </div>

    {/* Preview modal — shown when user selects an existing Rx from combobox */}
    <AnimatePresence>
      {rxPreview && !editRxDetail && (
        <RxPreviewModal
          rxHint={rxPreview}
          onClose={() => { setRxPreview(null); }}
          onConfirm={() => {
            handleRxChange(rxPreview.prescriptionNumber, rxPreview.id);
            setRxPreview(null);
          }}
          onEdit={(detail) => {
            setEditRxDetail(detail);
            setRxPreview(null);
          }}
        />
      )}
    </AnimatePresence>

    {/* Edit existing prescription */}
    <AnimatePresence>
      {editRxDetail && (
        <QuickPrescriptionModal
          initialPatientName={editRxDetail.patientName}
          prefilledDrugs={[]}
          editRx={editRxDetail}
          onClose={() => setEditRxDetail(null)}
          onCreated={(rxNumber, rxId) => {
            handleRxChange(rxNumber, rxId);
            setEditRxDetail(null);
          }}
        />
      )}
    </AnimatePresence>

    {/* Create new prescription */}
    <AnimatePresence>
      {showQuickCreate && (
        <QuickPrescriptionModal
          initialPatientName={quickCreateQuery}
          prefilledDrugs={controlledItems.map((i) => ({ medicineName: i.medicineName, schedule: i.schedule }))}
          onClose={() => setShowQuickCreate(false)}
          onCreated={(rxNumber, rxId) => {
            handleRxChange(rxNumber, rxId);
            setShowQuickCreate(false);
          }}
        />
      )}
    </AnimatePresence>
    </>
  );
}
