import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, Building2, User, CreditCard, Settings, CheckCircle2,
  ChevronRight, ChevronLeft, Copy, Download, Loader2, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FormData = {
  name: string;
  gstin: string;
  drugLicense: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  planName: "Free" | "Standard" | "Professional";
  doctorLimit: number;
  staffLimit: number;
  patientLimit: number;
  storageLimit: number;
  enableBilling: boolean;
  enableInventory: boolean;
  enableEmr: boolean;
  enableCrm: boolean;
  enableWhatsapp: boolean;
  enableSms: boolean;
  enableApiAccess: boolean;
  enableOnlineBooking: boolean;
};

const defaultForm: FormData = {
  name: "", gstin: "", drugLicense: "", address: "", city: "", state: "", pincode: "", phone: "", email: "",
  ownerName: "", ownerEmail: "", ownerPhone: "",
  planName: "Free",
  doctorLimit: 5, staffLimit: 5, patientLimit: 500, storageLimit: 1024,
  enableBilling: true, enableInventory: true, enableEmr: false, enableCrm: false,
  enableWhatsapp: false, enableSms: false, enableApiAccess: false, enableOnlineBooking: false,
};

const STEPS = [
  { key: "pharmacy", label: "Pharmacy Info", icon: Building2 },
  { key: "owner", label: "Owner Info", icon: User },
  { key: "subscription", label: "Subscription & Storage", icon: CreditCard },
  { key: "features", label: "Feature Flags & Review", icon: Settings },
] as const;

const PROVISIONING_STEPS = [
  "Creating Tenant",
  "Creating Owner",
  "Creating Subscription",
  "Applying Feature Flags",
  "Initializing Settings",
  "Completed",
];

export function NewPharmacyWizard({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [provisionStep, setProvisionStep] = useState(-1);
  const [result, setResult] = useState<{ tenantCode: string; temporaryPassword: string; pharmacyName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const toast = useToast();
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.post<{ data: { pharmacy: any; temporaryPassword: string } }>("/platform/tenants", data);
      return res.data.data;
    },
    onSuccess: (data) => {
      setResult({
        tenantCode: data.pharmacy.tenantCode,
        temporaryPassword: data.temporaryPassword,
        pharmacyName: data.pharmacy.name,
      });
      setProvisionStep(PROVISIONING_STEPS.length - 1);
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      toast.success("Pharmacy created successfully!");
    },
    onError: (err: any) => {
      setProvisionStep(-1);
      toast.error(err?.response?.data?.error || "Failed to create pharmacy");
    },
  });

  const update = (field: keyof FormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };

  const validateStep = () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!form.name.trim()) e.name = "Pharmacy name is required";
      if (form.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(form.gstin))
        e.gstin = "Invalid GST format";
    }
    if (step === 1) {
      if (!form.ownerName.trim()) e.ownerName = "Owner name is required";
      if (!form.ownerEmail.trim()) e.ownerEmail = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.ownerEmail)) e.ownerEmail = "Invalid email";
      if (form.ownerPhone && !/^\d{10}$/.test(form.ownerPhone)) e.ownerPhone = "Must be 10 digits";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setProvisionStep(0);
    // Simulate provisioning progress
    for (let i = 0; i < PROVISIONING_STEPS.length - 1; i++) {
      setProvisionStep(i);
      await new Promise((r) => setTimeout(r, 400));
    }
    createMutation.mutate(form);
  };

  const handleClose = () => {
    setStep(0);
    setForm(defaultForm);
    setErrors({});
    setProvisionStep(-1);
    setResult(null);
    setCopied(false);
    onClose();
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadCredentials = () => {
    if (!result) return;
    const text = `Pharmacy: ${result.pharmacyName}\nTenant Code: ${result.tenantCode}\nOwner Email: ${form.ownerEmail}\nTemporary Password: ${result.temporaryPassword}\n\n⚠️ Change this password on first login.`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credentials-${result.tenantCode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  // ── Success Screen ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 z-10"
        >
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Pharmacy Created!</h2>
            <p className="text-slate-500 mt-1">{result.pharmacyName} ({result.tenantCode})</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">⚠️ Temporary Password — shown only once</p>
            <div className="flex items-center gap-2 bg-white rounded-lg border border-amber-200 px-4 py-3">
              <code className="flex-1 text-lg font-mono font-bold text-slate-900 select-all tracking-wider">{result.temporaryPassword}</code>
              <button onClick={handleCopy} className="p-2 rounded-lg hover:bg-amber-50 text-amber-600 transition-colors" title="Copy">
                {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleDownloadCredentials} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <Download className="w-4 h-4" /> Download Credentials
            </button>
            <button onClick={handleClose} className="flex-1 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-500 transition-colors">
              Done
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Provisioning Progress ───────────────────────────────────────────────────
  if (provisionStep >= 0 && !result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 z-10"
        >
          <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">Provisioning Tenant</h2>
          <div className="space-y-3">
            {PROVISIONING_STEPS.map((s, i) => (
              <div key={s} className={cn("flex items-center gap-3 p-3 rounded-xl transition-all",
                i < provisionStep ? "bg-emerald-50" : i === provisionStep ? "bg-brand-50 ring-1 ring-brand-200" : "bg-slate-50 opacity-50"
              )}>
                {i < provisionStep ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : i === provisionStep ? (
                  <Loader2 className="w-5 h-5 text-brand-600 animate-spin shrink-0" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300 shrink-0" />
                )}
                <span className={cn("text-sm font-medium", i <= provisionStep ? "text-slate-900" : "text-slate-400")}>{s}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col z-10 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">New Pharmacy</h2>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center px-6 py-4 border-b border-slate-50 bg-slate-50/50 gap-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                    i === step ? "bg-brand-100 text-brand-700" :
                    i < step ? "text-emerald-700 cursor-pointer hover:bg-emerald-50" : "text-slate-400"
                  )}
                >
                  {i < step ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold",
                      i === step ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"
                    )}>{i + 1}</div>
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300 mx-1 shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              {step === 0 && <StepPharmacy form={form} errors={errors} update={update} />}
              {step === 1 && <StepOwner form={form} errors={errors} update={update} />}
              {step === 2 && <StepSubscription form={form} update={update} />}
              {step === 3 && <StepReview form={form} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-100 bg-white">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : handleClose()}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={handleNext} className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-500 transition-colors">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={createMutation.isPending} className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Create Pharmacy
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Step Components ─────────────────────────────────────────────────────────────

function InputField({ label, value, onChange, error, placeholder, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 transition-all",
          error ? "border-red-300 focus:ring-red-500/20 focus:border-red-500" : "border-slate-300 focus:ring-brand-500/20 focus:border-brand-500"
        )}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function StepPharmacy({ form, errors, update }: { form: FormData; errors: Record<string, string>; update: (k: keyof FormData, v: any) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Pharmacy Information</h3>
        <p className="text-sm text-slate-500">Basic details about the pharmacy</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <InputField label="Pharmacy Name" value={form.name} onChange={(v) => update("name", v)} error={errors.name} placeholder="e.g. MedPlus Pharmacy" required />
        </div>
        <InputField label="GST Number" value={form.gstin} onChange={(v) => update("gstin", v.toUpperCase())} error={errors.gstin} placeholder="22AAAAA0000A1Z5" />
        <InputField label="Drug License Number" value={form.drugLicense} onChange={(v) => update("drugLicense", v)} placeholder="DL-XX-XXXXX" />
        <div className="sm:col-span-2">
          <InputField label="Address" value={form.address} onChange={(v) => update("address", v)} placeholder="Shop No. 5, Medical Complex" />
        </div>
        <InputField label="City" value={form.city} onChange={(v) => update("city", v)} placeholder="Mumbai" />
        <InputField label="State" value={form.state} onChange={(v) => update("state", v)} placeholder="Maharashtra" />
        <InputField label="Pincode" value={form.pincode} onChange={(v) => update("pincode", v)} placeholder="400001" />
        <InputField label="Phone" value={form.phone} onChange={(v) => update("phone", v)} placeholder="9876543210" />
        <InputField label="Email" value={form.email} onChange={(v) => update("email", v)} placeholder="pharmacy@example.com" type="email" />
      </div>
    </div>
  );
}

function StepOwner({ form, errors, update }: { form: FormData; errors: Record<string, string>; update: (k: keyof FormData, v: any) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Owner Information</h3>
        <p className="text-sm text-slate-500">The owner will receive login credentials after creation</p>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <strong>Note:</strong> A secure temporary password will be automatically generated by the system and shown to you once after creation.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <InputField label="Owner Name" value={form.ownerName} onChange={(v) => update("ownerName", v)} error={errors.ownerName} placeholder="John Doe" required />
        </div>
        <InputField label="Email" value={form.ownerEmail} onChange={(v) => update("ownerEmail", v)} error={errors.ownerEmail} placeholder="owner@pharmacy.com" type="email" required />
        <InputField label="Mobile Number" value={form.ownerPhone} onChange={(v) => update("ownerPhone", v)} error={errors.ownerPhone} placeholder="9876543210" />
      </div>
    </div>
  );
}

function StepSubscription({ form, update }: { form: FormData; update: (k: keyof FormData, v: any) => void }) {
  const plans = [
    { name: "Free" as const, price: "₹0", desc: "Basic features for small pharmacies", color: "slate" },
    { name: "Standard" as const, price: "₹999/mo", desc: "Full features for growing pharmacies", color: "brand" },
    { name: "Professional" as const, price: "₹2,499/mo", desc: "Enterprise features with premium support", color: "indigo" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Subscription & Limits</h3>
        <p className="text-sm text-slate-500">Choose a plan and configure limits</p>
      </div>

      {/* Plan Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map((p) => (
          <button
            key={p.name}
            onClick={() => update("planName", p.name)}
            className={cn(
              "p-4 rounded-xl border-2 text-left transition-all",
              form.planName === p.name ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-slate-300"
            )}
          >
            <p className="font-bold text-slate-900">{p.name}</p>
            <p className="text-lg font-bold text-brand-600 mt-1">{p.price}</p>
            <p className="text-xs text-slate-500 mt-1">{p.desc}</p>
          </button>
        ))}
      </div>

      {/* Limits */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          ["doctorLimit", "Doctor Limit"],
          ["staffLimit", "Staff Limit"],
          ["patientLimit", "Patient Limit"],
          ["storageLimit", "Storage (MB)"],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
            <input
              type="number"
              value={form[key]}
              onChange={(e) => update(key, parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepReview({ form }: { form: FormData }) {
  const features = [
    ["enableBilling", "Billing"], ["enableInventory", "Inventory"], ["enableEmr", "EMR"],
    ["enableCrm", "CRM"], ["enableWhatsapp", "WhatsApp"], ["enableSms", "SMS"],
    ["enableApiAccess", "API Access"], ["enableOnlineBooking", "Online Booking"],
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Review & Create</h3>
        <p className="text-sm text-slate-500">Verify all details before creating the pharmacy</p>
      </div>

      {/* Pharmacy */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pharmacy</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{form.name || "--"}</span></div>
          <div><span className="text-slate-500">GST:</span> <span className="font-medium text-slate-900">{form.gstin || "--"}</span></div>
          <div><span className="text-slate-500">City:</span> <span className="font-medium text-slate-900">{form.city || "--"}</span></div>
          <div><span className="text-slate-500">State:</span> <span className="font-medium text-slate-900">{form.state || "--"}</span></div>
        </div>
      </div>

      {/* Owner */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Owner</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-900">{form.ownerName}</span></div>
          <div><span className="text-slate-500">Email:</span> <span className="font-medium text-slate-900">{form.ownerEmail}</span></div>
          <div><span className="text-slate-500">Phone:</span> <span className="font-medium text-slate-900">{form.ownerPhone || "--"}</span></div>
        </div>
      </div>

      {/* Plan + Limits */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Subscription & Limits</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><span className="text-slate-500">Plan:</span> <span className="font-bold text-brand-600">{form.planName}</span></div>
          <div><span className="text-slate-500">Doctors:</span> <span className="font-medium text-slate-900">{form.doctorLimit}</span></div>
          <div><span className="text-slate-500">Staff:</span> <span className="font-medium text-slate-900">{form.staffLimit}</span></div>
          <div><span className="text-slate-500">Patients:</span> <span className="font-medium text-slate-900">{form.patientLimit}</span></div>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Feature Flags</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {features.map(([key, label]) => (
            <div key={key} className={cn("px-3 py-2 rounded-lg text-xs font-medium", form[key] ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}>
              {form[key] ? "✓" : "✗"} {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
