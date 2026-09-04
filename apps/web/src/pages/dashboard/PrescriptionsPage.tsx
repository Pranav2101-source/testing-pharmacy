import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ListSkeleton } from "@/components/Skeleton";
import {
  Plus, Search, X, Loader2, ChevronLeft, ChevronRight,
  Stethoscope, User, Phone, Calendar, Pill, ClipboardList, Trash2,
  ExternalLink, AlertCircle, Hash, Upload, ImageIcon, FileIcon, Sparkles,
  Receipt,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { detectNewArrivals, arrivalToastMessage } from "@/lib/prescriptionArrivals";
import { playArrivalChime } from "@/lib/notifySound";
import { markPrescriptionViewed } from "@/lib/prescriptionNewCount";
import { useToast } from "@/hooks/useToast";
import ClinicCallbackPanel, { type DispenseNotify, type CancelNotify } from "@/components/integration/ClinicCallbackPanel";
import ReviewIngestedItemsPanel from "@/components/integration/ReviewIngestedItemsPanel";
import ConfirmQuantityPanel from "@/components/integration/ConfirmQuantityPanel";
import ClinicPrescriptionTriage from "@/components/integration/ClinicPrescriptionTriage";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { resolvePrescriptionToCart, canBill, roundUpConfirmMessage } from "@/lib/prescriptionToCart";
import {
  normalizeIndianMobile,
  sanitizeProfessionalName,
  validateIndianMobile,
  validateProfessionalName,
} from "@pharmacy/utils";

// ─── Drug schedule descriptions ───────────────────────────────────────────────

const SCHEDULE_TOOLTIP: Record<string, string> = {
  H:   "Schedule H — Prescription required (antibiotics, psychotropics, etc.)",
  H1:  "Schedule H1 — High-risk prescription drug (stricter record keeping required)",
  X:   "Schedule X — Controlled substance (narcotic/psychotropic, govt. license required)",
  G:   "Schedule G — Caution: to be taken under medical supervision",
  OTC: "OTC — Over the counter, no prescription needed",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PrescriptionStatus = "ACTIVE" | "PARTIAL" | "DISPENSED" | "EXPIRED" | "CANCELLED";

type PrescriptionItem = {
  id: string;
  medicineName: string;
  medicineId: string | null;
  schedule: string | null;
  quantity: number;
  dispensedQty: number;
  dosage: string | null;
  duration: string | null;
  notes: string | null;
  /** What was actually handed over, when it differs from what was prescribed. */
  dispensedMedicineName: string | null;
  substituted: boolean;
  /** Near-name catalogue candidates for a line the matcher could not link. Always empty once medicineId is set. */
  suggestions: MedicineSuggestion[];
};

/** A one-click candidate — never applied automatically, always a pharmacist's own choice. */
type MedicineSuggestion = {
  medicineId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  similarity: number;
};

type UploadRecord = { id: string; fileName: string; mimeType: string; fileUrl: string };

type Prescription = {
  id: string;
  prescriptionNumber: string;
  doctorId: string | null;
  doctorName: string;
  doctorRegNo: string | null;
  doctorPhone: string | null;
  patientName: string;
  patientAge: number | null;
  patientPhone: string | null;
  patientGender: string | null;
  prescribedDate: string | null;
  validUntil: string | null;
  status: PrescriptionStatus;
  notes: string | null;
  createdAt: string;
  doctor: { id: string; name: string } | null;
  upload: UploadRecord | null;
  items: PrescriptionItem[];
  invoices: { id: string; invoiceNumber: string; createdAt: string }[];
  /** Null for a counter-written prescription; the clinic tenant otherwise. */
  externalTenantId: string | null;
  /** Lines still needing a medicine chosen before this prescription can complete. */
  needsReview: number;
  dispenseNotify: DispenseNotify | null;
  cancelNotify: CancelNotify | null;
};

type ListResponse = { items: Prescription[]; total: number; page: number; limit: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<PrescriptionStatus, string> = {
  ACTIVE:    "bg-green-100 text-green-700",
  PARTIAL:   "bg-amber-100 text-amber-700",
  DISPENSED: "bg-blue-100 text-blue-700",
  EXPIRED:   "bg-slate-100 text-slate-500",
  CANCELLED: "bg-red-100 text-red-600",
};

function StatusBadge({ status }: { status: PrescriptionStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", STATUS_STYLE[status])}>
      {status}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return format(new Date(d), "dd MMM yyyy");
}

// ─── Doctor search for create modal ──────────────────────────────────────────

interface DoctorHint { id: string; name: string; specialty: string | null; registrationNo: string | null; }

function DoctorSearchInput({
  value,
  onChange,
}: {
  value: { name: string; id: string; regNo: string };
  onChange: (v: { name: string; id: string; regNo: string }) => void;
}) {
  const [query,    setQuery]    = useState(value.name);
  const [open,     setOpen]     = useState(false);
  const [hints,    setHints]    = useState<DoctorHint[]>([]);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropRef  = useRef<HTMLDivElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Sanitised before it reaches state or the search: digits belong in the
    // registration-number field beside this one, and the API rejects them here
    // (@ProfessionalName on CreatePrescriptionRequest.doctorName).
    const v = sanitizeProfessionalName(e.target.value);
    setQuery(v);
    onChange({ name: v, id: "", regNo: "" }); // clear regNo — only a picked doctor populates it
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length < 1) { setHints([]); setSearched(false); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ data: DoctorHint[] }>(
          `/doctors?search=${encodeURIComponent(v)}&limit=6`,
        );
        setHints(data.data ?? []);
        setSearched(true);
        setOpen(true);
      } catch { setHints([]); }
    }, 220);
  }

  function pick(d: DoctorHint) {
    setQuery(d.name);
    onChange({ name: d.name, id: d.id, regNo: d.registrationNo ?? "" });
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={handleChange}
        placeholder="Doctor name (or search)"
        className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
      />
      {open && (
        <div
          ref={dropRef}
          className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50"
        >
          {hints.length === 0 && searched && (
            <p className="px-3 py-2 text-[12px] text-slate-400">No doctors found</p>
          )}
          {hints.map((d) => (
            <button
              key={d.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(d); }}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-b-0"
            >
              <p className="text-[13px] font-semibold text-slate-800">{d.name}</p>
              {d.registrationNo && (
                <p className="text-[11px] text-slate-400">Reg #{d.registrationNo}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

type DrugRow = {
  medicineName: string;
  schedule: string;
  quantity: string;
  dosage: string;
  duration: string;
  notes: string;
};

const BLANK_DRUG: DrugRow = { medicineName: "", schedule: "", quantity: "1", dosage: "", duration: "", notes: "" };

type UploadState = { uploadId: string; fileName: string; signedUrl: string; mimeType: string };

type CreateForm = {
  doctor: { name: string; id: string; regNo: string };
  doctorPhone: string;
  patientName: string;
  patientAge: string;
  patientPhone: string;
  patientGender: string;
  prescribedDate: string;
  validUntil: string;
  notes: string;
  drugs: DrugRow[];
};

const BLANK_FORM: CreateForm = {
  doctor:        { name: "", id: "", regNo: "" },
  doctorPhone:   "",
  patientName:   "",
  patientAge:    "",
  patientPhone:  "",
  patientGender: "",
  prescribedDate: "",
  validUntil:    "",
  notes:         "",
  drugs:         [{ ...BLANK_DRUG }],
};

function CreateModal({ onClose }: { onClose: () => void }) {
  const [form,        setForm]        = useState<CreateForm>(BLANK_FORM);
  const [errors,      setErrors]      = useState<Record<string, string | null>>({});
  const [saving,      setSaving]      = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ data: { id: string; fileName: string; signedUrl: string; mimeType: string } }>(
        "/uploads/prescription",
        fd,
      );
      setUploadState({
        uploadId:  data.data.id,
        fileName:  data.data.fileName,
        signedUrl: data.data.signedUrl ?? "",
        mimeType:  data.data.mimeType,
      });
      toast.success("Prescription image uploaded");
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
      // reset so the same file can be re-selected after removal
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeUpload() {
    setUploadState(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function setField<K extends keyof CreateForm>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  function updateDrug(idx: number, k: keyof DrugRow, v: string) {
    setForm(f => ({ ...f, drugs: f.drugs.map((d, i) => i === idx ? { ...d, [k]: v } : d) }));
  }

  function addDrug() {
    setForm(f => ({ ...f, drugs: [...f.drugs, { ...BLANK_DRUG }] }));
  }

  function removeDrug(idx: number) {
    setForm(f => ({ ...f, drugs: f.drugs.filter((_, i) => i !== idx) }));
  }

  /** Shared by both save paths — a draft and a finished prescription send the same shape. */
  function buildPayload() {
    return {
      uploadId:       uploadState?.uploadId || undefined,
      doctorId:       form.doctor.id  || undefined,
      doctorName:     form.doctor.name.trim(),
      doctorRegNo:    form.doctor.regNo.trim()  || undefined,
      doctorPhone:    form.doctorPhone.trim()   || undefined,
      patientName:    form.patientName.trim(),
      patientAge:     form.patientAge ? parseInt(form.patientAge, 10) : undefined,
      patientPhone:   form.patientPhone.trim()  || undefined,
      patientGender:  (form.patientGender as "M" | "F" | "Other") || undefined,
      prescribedDate: form.prescribedDate ? `${form.prescribedDate}T00:00:00.000Z` : undefined,
      validUntil:     form.validUntil    ? `${form.validUntil}T00:00:00.000Z`    : undefined,
      notes:          form.notes.trim()  || undefined,
      items: form.drugs
        .filter(d => d.medicineName.trim())
        .map(d => ({
          medicineName: d.medicineName.trim(),
          schedule:     (d.schedule as "H" | "H1" | "X" | "G" | "OTC") || undefined,
          quantity:     parseInt(d.quantity, 10) || 1,
          dosage:       d.dosage.trim()   || undefined,
          duration:     d.duration.trim() || undefined,
          notes:        d.notes.trim()    || undefined,
        })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.drugs.every(d => !d.medicineName.trim())) { toast.error("Add at least one medicine"); return; }

    // Mirrors CreatePrescriptionRequest: @ProfessionalName on both names, @IndianMobile
    // on both phones. Validated here so the reason lands on the field instead of
    // arriving as a 400 after the form has been filled in.
    const problems: Record<string, string | null> = {
      doctorName:   validateProfessionalName(form.doctor.name, { label: "Doctor name", maxLength: 200 }),
      patientName:  validateProfessionalName(form.patientName, { label: "Patient name", maxLength: 200 }),
      doctorPhone:  validateIndianMobile(form.doctorPhone,  { label: "Doctor phone",  required: false }),
      patientPhone: validateIndianMobile(form.patientPhone, { label: "Patient phone", required: false }),
    };
    const firstProblem = Object.values(problems).find(Boolean);
    if (firstProblem) {
      setErrors(problems);
      toast.error(firstProblem);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      await api.post("/prescriptions", buildPayload());
      toast.success("Prescription created");
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      onClose();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to create prescription"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6 overflow-hidden">
        {/* Header */}
        <div className="bg-violet-700 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-violet-200 text-[11px] font-semibold tracking-wide uppercase">New Prescription</p>
            <h2 className="text-white text-[18px] font-bold leading-snug">Record Prescription</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-1.5 bg-white text-violet-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-violet-50 transition-colors disabled:opacity-60"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Prescription
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-160px)]">

          {/* ── Doctor section ── */}
          <div>
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5" /> Prescribing Doctor
            </p>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Name <span className="text-red-500">*</span>
                </label>
                <DoctorSearchInput
                  value={form.doctor}
                  onChange={(v) => setForm(f => ({ ...f, doctor: v }))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Registration No.
                </label>
                <input
                  value={form.doctor.regNo}
                  onChange={(e) => setForm(f => ({ ...f, doctor: { ...f.doctor, regNo: e.target.value } }))}
                  placeholder="MCI / State reg. no."
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* ── Patient section ── */}
          <div>
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Patient Details
            </p>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.patientName}
                  // Sanitised per keystroke, so a digit never lands in the field. A
                  // patient name is transcribed off a paper script; the professional
                  // rule keeps "Ram Kumar (S/O Shyam)" typeable while blocking digits.
                  onChange={(e) => {
                    setForm(f => ({ ...f, patientName: sanitizeProfessionalName(e.target.value) }));
                    setErrors(x => ({ ...x, patientName: null }));
                  }}
                  required
                  maxLength={200}
                  aria-invalid={!!errors.patientName}
                  placeholder="Full name"
                  className={cn(
                    "w-full border-b pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors",
                    errors.patientName ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-blue-500",
                  )}
                />
                {errors.patientName && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.patientName}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Age</label>
                <input
                  value={form.patientAge}
                  onChange={setField("patientAge")}
                  type="number"
                  min="0"
                  max="150"
                  placeholder="Years"
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Phone</label>
                <input
                  value={form.patientPhone}
                  onChange={(e) => {
                    setForm(f => ({ ...f, patientPhone: normalizeIndianMobile(e.target.value) }));
                    setErrors(x => ({ ...x, patientPhone: null }));
                  }}
                  type="tel" inputMode="numeric" maxLength={10}
                  aria-invalid={!!errors.patientPhone}
                  placeholder="10-digit mobile"
                  className={cn(
                    "w-full border-b pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors",
                    errors.patientPhone ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-blue-500",
                  )}
                />
                {errors.patientPhone && <p className="text-[11px] text-red-500 font-medium mt-1">{errors.patientPhone}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Gender</label>
                <select
                  value={form.patientGender}
                  onChange={setField("patientGender")}
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-700 bg-transparent focus:outline-none transition-colors"
                >
                  <option value="">Select</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Dates ── */}
          <div>
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Dates
            </p>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Prescribed Date</label>
                <input
                  type="date"
                  value={form.prescribedDate}
                  onChange={setField("prescribedDate")}
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 bg-transparent focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Valid Until</label>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={setField("validUntil")}
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 bg-transparent focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* ── Upload prescription image ── */}
          <div>
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> Prescription Image (Evidence)
            </p>

            {uploadState ? (
              <div className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-4 py-3">
                {uploadState.mimeType.startsWith("image/") ? (
                  <img
                    src={uploadState.signedUrl}
                    alt="Prescription"
                    className="w-14 h-14 rounded-lg object-cover border border-green-200 flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
                    <FileIcon className="w-6 h-6 text-green-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{uploadState.fileName}</p>
                  <p className="text-[11px] text-green-600 font-medium mt-0.5">Uploaded successfully</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {uploadState.signedUrl && (
                    <a
                      href={uploadState.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      View
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={removeUpload}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <label className={cn(
                "flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-6 cursor-pointer transition-colors",
                uploading
                  ? "border-violet-300 bg-violet-50 cursor-wait"
                  : "border-slate-200 hover:border-violet-400 hover:bg-violet-50",
              )}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                {uploading ? (
                  <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-slate-400" />
                )}
                <div className="text-center">
                  <p className="text-[13px] font-semibold text-slate-600">
                    {uploading ? "Uploading…" : "Click to upload prescription"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">JPEG, PNG, WebP or PDF · max 5 MB</p>
                </div>
              </label>
            )}
          </div>

          {/* ── Drug rows ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide flex items-center gap-1.5">
                <Pill className="w-3.5 h-3.5" /> Medicines
              </p>
              <button
                type="button"
                onClick={addDrug}
                className="flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
            </div>

            <div className="space-y-3">
              {/* Column headers */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 px-1">
                {["Medicine Name *", "Schedule", "Qty *", "Dosage", "Duration", ""].map((h) => (
                  <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{h}</p>
                ))}
              </div>

              {form.drugs.map((drug, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-center">
                  <input
                    value={drug.medicineName}
                    onChange={(e) => updateDrug(idx, "medicineName", e.target.value)}
                    placeholder="Medicine name"
                    className="border-b border-slate-200 focus:border-blue-400 pb-1 text-[13px] text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none transition-colors"
                  />
                  <select
                    value={drug.schedule}
                    onChange={(e) => updateDrug(idx, "schedule", e.target.value)}
                    className="border-b border-slate-200 focus:border-blue-400 pb-1 text-[13px] text-slate-700 bg-transparent focus:outline-none transition-colors"
                  >
                    <option value="">Any</option>
                    <option value="H">H</option>
                    <option value="H1">H1</option>
                    <option value="X">X</option>
                    <option value="G">G</option>
                    <option value="OTC">OTC</option>
                  </select>
                  <input
                    type="number"
                    value={drug.quantity}
                    onChange={(e) => updateDrug(idx, "quantity", e.target.value)}
                    min="1"
                    className="border-b border-slate-200 focus:border-blue-400 pb-1 text-[13px] text-slate-800 bg-transparent focus:outline-none transition-colors"
                  />
                  <input
                    value={drug.dosage}
                    onChange={(e) => updateDrug(idx, "dosage", e.target.value)}
                    placeholder="e.g. 1-0-1"
                    className="border-b border-slate-200 focus:border-blue-400 pb-1 text-[13px] text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none transition-colors"
                  />
                  <input
                    value={drug.duration}
                    onChange={(e) => updateDrug(idx, "duration", e.target.value)}
                    placeholder="e.g. 5 days"
                    className="border-b border-slate-200 focus:border-blue-400 pb-1 text-[13px] text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => removeDrug(idx)}
                    disabled={form.drugs.length === 1}
                    className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Notes ── */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Notes</label>
            <textarea
              value={form.notes}
              onChange={setField("notes")}
              rows={2}
              placeholder="Internal notes (not printed)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>

        </form>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ rx: initialRx, onClose, onCancelled }: { rx: Prescription; onClose: () => void; onCancelled: () => void }) {
  const [cancelling,  setCancelling]  = useState(false);
  const [viewingFile, setViewingFile] = useState(false);
  const [billing,     setBilling]     = useState(false);
  // Fetch the full record so invoices (excluded from list query) are populated
  const [rx, setRx] = useState<Prescription>(initialRx);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate  = useNavigate();
  const loadDraft = useBillingStore((s) => s.loadDraft);

  useEffect(() => {
    api.get<{ data: Prescription }>(`/prescriptions/${initialRx.id}`)
      .then(r => setRx(r.data.data))
      .catch(() => {}); // silently keep initialRx on error
  }, [initialRx.id]);

  async function openUpload() {
    if (!rx.upload) return;
    setViewingFile(true);
    try {
      const { data } = await api.get<{ data: { signedUrl: string | null } }>(
        `/uploads/${rx.upload.id}/signed-url`,
      );
      if (data.data.signedUrl) {
        window.open(data.data.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Could not generate a view link. Try again.");
      }
    } catch {
      toast.error("Failed to open prescription file");
    } finally {
      setViewingFile(false);
    }
  }

  const canCancel = rx.status === "ACTIVE" || rx.status === "PARTIAL";

  async function handleCancel() {
    if (!confirm(`Cancel prescription ${rx.prescriptionNumber}? This cannot be undone.`)) return;
    setCancelling(true);
    try {
      await api.delete(`/prescriptions/${rx.id}`);
      toast.success("Prescription cancelled");
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      onCancelled();
    } catch (err: any) {
      toast.error(getErrorMessage(err, "Failed to cancel prescription"));
    } finally {
      setCancelling(false);
    }
  }

  const canBillNow = (rx.status === "ACTIVE" || rx.status === "PARTIAL")
    && canBill(rx, rx.needsReview);

  /**
   * Jumps to New Bill with the cart pre-filled, instead of making a pharmacist re-search
   * every medicine. Same shared resolver the clinic triage view uses, so a prescription
   * billed from here and one billed from there produce an identical cart.
   */
  async function billNow() {
    setBilling(true);
    try {
      const { items, meta, failures, checkFailed, partials, roundedToPack } = await resolvePrescriptionToCart(rx);
      if (items.length === 0) {
        toast.error(
          failures.length === 0 && checkFailed.length > 0
            ? "Couldn't check stock — check your connection and try again"
            : "None of these medicines are in stock right now",
        );
        return;
      }
      // Rounding a course up to a full pack overcharges the patient — block until the
      // pharmacist accepts it, don't rely on a toast they might miss.
      const roundMsg = roundUpConfirmMessage(roundedToPack);
      if (roundMsg && !window.confirm(roundMsg)) return;
      loadDraft(items, meta);
      if (failures.length > 0) {
        toast.error(`Not in stock: ${failures.join(", ")} — add manually or substitute`);
      }
      if (checkFailed.length > 0) {
        toast.error(`Couldn't check stock for: ${checkFailed.join(", ")} — add manually if needed`);
      }
      if (partials.length > 0) {
        toast.info(partials.map((p) => `${p.medicineName}: billed ${p.available} of ${p.requested}`).join(" · "));
      }
      navigate("/dashboard/billing/new");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not prepare the bill"));
    } finally {
      setBilling(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-6 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-slate-400 text-[11px] font-semibold tracking-wide uppercase">Prescription</p>
              <StatusBadge status={rx.status} />
            </div>
            <h2 className="text-white text-[18px] font-bold leading-snug">{rx.prescriptionNumber}</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {canBillNow && (
              <button
                type="button"
                onClick={billNow}
                disabled={billing}
                className="flex items-center gap-1.5 bg-emerald-500 text-white font-bold text-[12px] px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-60"
              >
                {billing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
                Bill Now
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-1.5 bg-red-500 text-white font-bold text-[12px] px-4 py-2 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-60"
              >
                {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Cancel Rx
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-160px)]">

          {/* Doctor + Patient */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <Stethoscope className="w-3 h-3" /> Doctor
              </p>
              <p className="text-[14px] font-bold text-slate-800">{rx.doctorName}</p>
              {rx.doctorRegNo  && <p className="text-[12px] text-slate-500">Reg #{rx.doctorRegNo}</p>}
              {rx.doctorPhone  && <p className="text-[12px] text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{rx.doctorPhone}</p>}
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <User className="w-3 h-3" /> Patient
              </p>
              <p className="text-[14px] font-bold text-slate-800">{rx.patientName}</p>
              {rx.patientAge   && <p className="text-[12px] text-slate-500">{rx.patientAge} yrs{rx.patientGender ? ` · ${rx.patientGender}` : ""}</p>}
              {rx.patientPhone && <p className="text-[12px] text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{rx.patientPhone}</p>}
            </div>
          </div>

          {/* Dates */}
          <div className="flex items-center gap-6 text-[12px] text-slate-500">
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Prescribed: {fmtDate(rx.prescribedDate)}</span>
            {rx.validUntil && <span>Valid until: {fmtDate(rx.validUntil)}</span>}
            <span>Created: {fmtDate(rx.createdAt)}</span>
          </div>

          {/* Clinic integration: what still needs a human, and what the clinic has been told. */}
          <div className="space-y-2">
            <ReviewIngestedItemsPanel
              prescriptionId={rx.id}
              items={rx.items ?? []}
              onLinked={async () => {
                const { data } = await api.get(`/prescriptions/${rx.id}`);
                setRx(data.data);
                qc.invalidateQueries({ queryKey: ["prescriptions"] });
              }}
            />
            <ConfirmQuantityPanel
              prescriptionId={rx.id}
              items={rx.items ?? []}
              onConfirmed={async () => {
                const { data } = await api.get(`/prescriptions/${rx.id}`);
                setRx(data.data);
                qc.invalidateQueries({ queryKey: ["prescriptions"] });
              }}
            />
            <ClinicCallbackPanel
              prescriptionId={rx.id}
              notify={rx.dispenseNotify}
              onRetried={async () => {
                const { data } = await api.get(`/prescriptions/${rx.id}`);
                setRx(data.data);
              }}
            />
            <ClinicCallbackPanel
              kind="cancel"
              prescriptionId={rx.id}
              notify={rx.cancelNotify}
              onRetried={async () => {
                const { data } = await api.get(`/prescriptions/${rx.id}`);
                setRx(data.data);
              }}
            />
          </div>

          {/* Medicines table */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Pill className="w-3.5 h-3.5" /> Medicines ({rx.items?.length ?? 0})
            </p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wide font-bold">
                  <tr>
                    <th className="px-3 py-2 text-left">Medicine</th>
                    <th className="px-3 py-2 text-center">Sch</th>
                    <th className="px-3 py-2 text-center">Qty</th>
                    <th className="px-3 py-2 text-center">Dispensed</th>
                    <th className="px-3 py-2 text-left">Dosage</th>
                    <th className="px-3 py-2 text-left">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(rx.items ?? []).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {item.medicineName}
                        {item.substituted && item.dispensedMedicineName && (
                          <span className="block text-[11px] font-normal text-amber-700">
                            Dispensed: {item.dispensedMedicineName}
                          </span>
                        )}
                        {item.medicineId === null && (
                          <span className="block text-[11px] font-normal text-amber-700">
                            Not linked to your catalogue
                          </span>
                        )}
                        {item.quantity <= 0 && (
                          <span className="block text-[11px] font-normal text-sky-700">
                            Quantity not confirmed
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.schedule
                          ? <span
                              title={SCHEDULE_TOOLTIP[item.schedule] ?? item.schedule}
                              className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold cursor-help", item.schedule === "X" ? "bg-red-100 text-red-700" : item.schedule === "H1" ? "bg-orange-100 text-orange-700" : item.schedule === "H" ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-600")}>
                              {item.schedule}
                            </span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono">
                        {item.quantity > 0 ? item.quantity : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-blue-600">{item.dispensedQty}</td>
                      <td className="px-3 py-2 text-slate-600">{item.dosage || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.duration || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Linked invoices */}
          {(rx.invoices?.length ?? 0) > 0 && (
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Linked Invoices
              </p>
              <div className="space-y-1.5">
                {(rx.invoices ?? []).map((inv) => (
                  <Link
                    key={inv.id}
                    to={`/dashboard/billing/${inv.id}`}
                    className="flex items-center justify-between px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <span className="text-[13px] font-semibold text-blue-700">{inv.invoiceNumber}</span>
                    <span className="flex items-center gap-1 text-[11px] text-blue-500">
                      {fmtDate(inv.createdAt)}
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Prescription image / file */}
          {rx.upload && (
            <div className="border border-slate-200 rounded-xl p-4">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Prescription Evidence
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
                  {rx.upload.mimeType?.startsWith("image/") ? (
                    <ImageIcon className="w-5 h-5 text-violet-500" />
                  ) : (
                    <FileIcon className="w-5 h-5 text-violet-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{rx.upload.fileName}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {rx.upload.mimeType?.startsWith("image/") ? "Image" : "PDF document"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openUpload}
                  disabled={viewingFile}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-bold transition-colors disabled:opacity-60 flex-shrink-0"
                >
                  {viewingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                  View
                </button>
              </div>
            </div>
          )}

          {/* Notes */}
          {rx.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-[13px] text-amber-900">{rx.notes}</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All",       value: "" },
  { label: "Active",    value: "ACTIVE" },
  { label: "Partial",   value: "PARTIAL" },
  { label: "Dispensed", value: "DISPENSED" },
  { label: "Expired",   value: "EXPIRED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const PAGE_LIMIT = 20;

export default function PrescriptionsPage() {
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page,         setPage]         = useState(1);
  const [showCreate,   setShowCreate]   = useState(false);
  const [detail,       setDetail]       = useState<Prescription | null>(null);
  const [triage,       setTriage]       = useState<Prescription | null>(null);
  const toast = useToast();

  // reset page on filter change
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_LIMIT),
    ...(search       ? { search }       : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["prescriptions", page, search, statusFilter],
    queryFn:  () =>
      api.get<{ success: boolean; data: ListResponse }>(`/prescriptions?${params}`)
         .then(r => r.data.data),
    staleTime: 8_000,
    // A clinic pushes a prescription with nobody at this pharmacy having done anything —
    // without a poll it sits invisible until someone happens to reload. react-query only
    // polls while the tab is focused (refetchIntervalInBackground defaults to false), so
    // this doesn't run up API calls in a background tab.
    refetchInterval: 8_000,
  });

  const qc = useQueryClient();

  // Ids this screen has already shown at least once, across every page and poll this
  // session — a running union, not just "this page's ids", so paging away and back does
  // not make already-seen rows look freshly arrived again. null until the first load
  // establishes the baseline; nothing on that first load counts as "new".
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [newlyArrivedIds, setNewlyArrivedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const { arrived, isFirstLoad } = detectNewArrivals(data.items, seenIdsRef.current);
    if (isFirstLoad) {
      seenIdsRef.current = new Set(data.items.map((rx) => rx.id));
      return;
    }
    data.items.forEach((rx) => seenIdsRef.current!.add(rx.id));
    if (arrived.length === 0) return;

    setNewlyArrivedIds((prev) => {
      const next = new Set(prev);
      arrived.forEach((rx) => next.add(rx.id));
      return next;
    });
    toast.info(arrivalToastMessage(arrived));
    playArrivalChime();
  }, [data, toast]);

  // Marks a row acknowledged the moment a pharmacist actually looks at it — simpler than a
  // timer, and ties "seen" to the action that means it was seen.
  function openDetail(rx: Prescription) {
    // A clinic-sent prescription that is still open gets the triage view: it arrived without
    // anyone here asking for it, and what it needs is a decision (fill / keep / refuse), not
    // a record to read. Anything counter-written, or already closed, goes to the full detail
    // view — by then the useful thing is the history, not the choice.
    const needsDecision = rx.externalTenantId != null
      && (rx.status === "ACTIVE" || rx.status === "PARTIAL");
    if (needsDecision) {
      setTriage(rx);
    } else {
      setDetail(rx);
    }
    if (newlyArrivedIds.has(rx.id)) {
      setNewlyArrivedIds((prev) => {
        const next = new Set(prev);
        next.delete(rx.id);
        return next;
      });
    }
    // Durable counterpart to the in-memory pill above: clears the nav badge even when
    // this row wasn't flagged "newly arrived" in THIS session (e.g. it arrived before
    // the page was ever opened this visit).
    if (rx.externalTenantId != null) {
      markPrescriptionViewed(rx.id, qc);
    }
  }

  // When a detail is open and we cancel, reload detail or close
  async function handleDetailCancelled() {
    if (!detail) return;
    try {
      const { data: fresh } = await api.get<{ data: Prescription }>(`/prescriptions/${detail.id}`);
      setDetail(fresh.data);
    } catch {
      setDetail(null);
    }
    qc.invalidateQueries({ queryKey: ["prescriptions"] });
  }

  const prescriptions = data?.items ?? [];
  const total         = data?.total  ?? 0;
  const totalPages    = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    // h-full + own scroll: DashboardLayout's <main> is overflow-hidden, so a
    // page that doesn't scroll itself just clips its list past the fold.
    <div className="h-full overflow-y-auto p-6 space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-violet-600" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-slate-800">Prescriptions</h1>
            <p className="text-[12px] text-slate-500">{isLoading ? "Loading…" : `${total} prescription${total !== 1 ? "s" : ""} on record`}</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Prescription
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 flex-1 min-w-[220px] max-w-sm shadow-sm">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Rx no., patient, doctor…"
            className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors",
                statusFilter === f.value
                  ? "bg-violet-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {isLoading ? (
          <ListSkeleton />
        ) : prescriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <AlertCircle className="w-8 h-8" />
            <p className="text-[14px] font-medium">No prescriptions found</p>
            {!search && !statusFilter && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 mt-1 text-[13px] font-semibold text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Plus className="w-4 h-4" /> Record your first prescription
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Rx No.</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Patient</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Doctor</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Items</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Date</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prescriptions.map((rx) => (
                <tr
                  key={rx.id}
                  className={cn(
                    "hover:bg-slate-50 cursor-pointer transition-colors",
                    newlyArrivedIds.has(rx.id) && "bg-violet-50/70",
                  )}
                  onClick={() => openDetail(rx)}
                >
                  <td className="px-5 py-3.5 font-mono font-bold text-violet-700">
                    <span className="inline-flex items-center gap-1.5">
                      {rx.prescriptionNumber}
                      {newlyArrivedIds.has(rx.id) && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-bold uppercase tracking-wide">
                          <Sparkles className="w-2.5 h-2.5" /> New
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-slate-800">{rx.patientName}</p>
                    {rx.patientPhone && (
                      <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-2.5 h-2.5" />{rx.patientPhone}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{rx.doctorName}</td>
                  <td className="px-5 py-3.5 text-center text-slate-600">{rx.items?.length ?? 0}</td>
                  <td className="px-5 py-3.5 text-slate-500">{fmtDate(rx.createdAt)}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={rx.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-[12px] text-slate-500">
              Page {page} of {totalPages} · {total} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      {triage && (
        <ClinicPrescriptionTriage
          rx={triage}
          onClose={() => setTriage(null)}
          onChanged={async () => {
            // Re-read rather than patching local state: linking a medicine changes
            // needsReview, which is what gates the three actions.
            try {
              const { data } = await api.get<{ data: Prescription }>(`/prescriptions/${triage.id}`);
              setTriage(data.data);
            } catch { /* keep what's on screen */ }
            qc.invalidateQueries({ queryKey: ["prescriptions"] });
          }}
          onOpenFullDetail={() => { setDetail(triage); setTriage(null); }}
        />
      )}
      {detail && (
        <DetailModal
          rx={detail}
          onClose={() => setDetail(null)}
          onCancelled={handleDetailCancelled}
        />
      )}
    </div>
  );
}
