"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Upload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  X,
  Trash2,
  Eye,
  Hash,
  Calendar,
  FileBadge,
  CreditCard,
  Landmark,
  Store,
  GraduationCap,
  Banknote,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type DocStatus = "pending" | "uploaded" | "expired";

interface DocEntry {
  id:         string;
  title:      string;
  icon:       React.ElementType;
  docNumber:  string;
  expiryDate: string;
  fileName:   string | null;
  status:     DocStatus;
  required:   boolean;
}

// ─── Status badge ─────────────────────────────────────────────
function StatusBadge({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { label: string; cls: string; Icon: React.ElementType }> = {
    uploaded: { label: "Uploaded",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2    },
    pending:  { label: "Pending",   cls: "bg-amber-50   text-amber-700   border-amber-200",   Icon: Clock           },
    expired:  { label: "Expired",   cls: "bg-red-50     text-red-600     border-red-200",     Icon: AlertTriangle   },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold", cls)}>
      <Icon className="w-2.5 h-2.5" strokeWidth={2.2} />
      {label}
    </span>
  );
}

// ─── Document card ────────────────────────────────────────────
function DocCard({
  doc,
  onChange,
  onRemoveFile,
}: {
  doc: DocEntry;
  onChange: (id: string, field: keyof DocEntry, value: string) => void;
  onRemoveFile: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const Icon = doc.icon;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange(doc.id, "fileName", file.name);
    onChange(doc.id, "status", "uploaded");
  }

  const [numFocused,    setNumFocused]    = useState(false);
  const [expFocused,    setExpFocused]    = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-100 shadow-card hover:shadow-card-md transition-shadow p-5 flex flex-col gap-4"
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
            doc.status === "uploaded" ? "bg-emerald-50" :
            doc.status === "expired"  ? "bg-red-50"     : "bg-slate-100"
          )}>
            <Icon
              className={cn(
                "w-4.5 h-4.5",
                doc.status === "uploaded" ? "text-emerald-600" :
                doc.status === "expired"  ? "text-red-500"     : "text-slate-500"
              )}
              style={{ width: 18, height: 18 }}
              strokeWidth={1.8}
            />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{doc.title}</p>
            {doc.required && <p className="text-[10px] text-slate-400 mt-0.5">Required</p>}
          </div>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-3">
        {/* Doc number */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Document Number
          </label>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-50 transition-all duration-150",
            numFocused ? "border-brand-400 ring-1 ring-brand-200 bg-white" : "border-slate-200 hover:border-slate-300"
          )}>
            <Hash className={cn("w-3 h-3 flex-shrink-0", numFocused ? "text-brand-500" : "text-slate-400")} strokeWidth={1.8} />
            <input
              type="text"
              placeholder="Enter number"
              value={doc.docNumber}
              onChange={(e) => onChange(doc.id, "docNumber", e.target.value)}
              onFocus={() => setNumFocused(true)}
              onBlur={() => setNumFocused(false)}
              className="flex-1 text-xs text-slate-700 placeholder-slate-300 bg-transparent outline-none"
            />
          </div>
        </div>

        {/* Expiry date */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Expiry Date
          </label>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-50 transition-all duration-150",
            expFocused ? "border-brand-400 ring-1 ring-brand-200 bg-white" : "border-slate-200 hover:border-slate-300"
          )}>
            <Calendar className={cn("w-3 h-3 flex-shrink-0", expFocused ? "text-brand-500" : "text-slate-400")} strokeWidth={1.8} />
            <input
              type="date"
              value={doc.expiryDate}
              onChange={(e) => onChange(doc.id, "expiryDate", e.target.value)}
              onFocus={() => setExpFocused(true)}
              onBlur={() => setExpFocused(false)}
              className="flex-1 text-xs text-slate-700 bg-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Upload area */}
      <div>
        {doc.fileName ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
            <FileText className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" strokeWidth={1.8} />
            <span className="flex-1 text-xs text-emerald-700 font-medium truncate">{doc.fileName}</span>
            <button
              onClick={() => { onRemoveFile(doc.id); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-emerald-500 hover:text-red-500 transition-colors"
              aria-label="Remove file"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button className="text-emerald-500 hover:text-emerald-700 transition-colors" aria-label="View file">
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50 rounded-xl transition-all text-xs font-semibold text-slate-500 hover:text-brand-600 group"
          >
            <Upload className="w-3.5 h-3.5 group-hover:text-brand-500 transition-colors" strokeWidth={1.8} />
            Upload Document
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={handleFile}
        />
        <p className="text-[10px] text-slate-300 mt-1.5 text-center">PDF, JPG, PNG · Max 5 MB</p>
      </div>
    </motion.div>
  );
}

// ─── Custom document modal ────────────────────────────────────
function AddCustomModal({
  onAdd,
  onClose,
}: {
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1,    y: 0  }}
        exit={  { scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-slate-800">Add Custom Document</p>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 mb-5">
          <label className="text-xs font-semibold text-slate-600">Document Name</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Trade License"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim()); } }}
            className="px-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-200 text-sm text-slate-800 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (name.trim()) onAdd(name.trim()); }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Document
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Default documents ────────────────────────────────────────
const DEFAULT_DOCS: DocEntry[] = [
  { id: "drug-license",    title: "Drug License",                icon: ShieldCheck,    docNumber: "", expiryDate: "", fileName: null, status: "pending", required: true  },
  { id: "gst-cert",        title: "GST Certificate",            icon: FileText,       docNumber: "", expiryDate: "", fileName: null, status: "pending", required: true  },
  { id: "pan",             title: "PAN Card",                   icon: CreditCard,     docNumber: "", expiryDate: "", fileName: null, status: "pending", required: true  },
  { id: "aadhaar",         title: "Aadhaar Card",               icon: FileBadge,      docNumber: "", expiryDate: "", fileName: null, status: "pending", required: false },
  { id: "shop-reg",        title: "Shop Registration",          icon: Store,          docNumber: "", expiryDate: "", fileName: null, status: "pending", required: true  },
  { id: "pharma-cert",     title: "Pharmacist Certificate",     icon: GraduationCap,  docNumber: "", expiryDate: "", fileName: null, status: "pending", required: true  },
  { id: "bank-details",    title: "Cancelled Cheque / Bank",    icon: Banknote,       docNumber: "", expiryDate: "", fileName: null, status: "pending", required: false },
];

// ─── Page ─────────────────────────────────────────────────────
export default function DocumentsPage() {
  const [docs,       setDocs]       = useState<DocEntry[]>(DEFAULT_DOCS);
  const [showModal,  setShowModal]  = useState(false);

  function handleChange(id: string, field: keyof DocEntry, value: string) {
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  }

  function handleRemoveFile(id: string) {
    setDocs((prev) =>
      prev.map((d) => d.id === id ? { ...d, fileName: null, status: "pending" } : d)
    );
  }

  function handleAddCustom(name: string) {
    const newDoc: DocEntry = {
      id:         `custom-${Date.now()}`,
      title:      name,
      icon:       FileText,
      docNumber:  "",
      expiryDate: "",
      fileName:   null,
      status:     "pending",
      required:   false,
    };
    setDocs((prev) => [...prev, newDoc]);
    setShowModal(false);
  }

  function handleDeleteCustom(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  const uploadedCount = docs.filter((d) => d.status === "uploaded").length;
  const customDocs    = docs.filter((d) => d.id.startsWith("custom-"));
  const coreDocs      = docs.filter((d) => !d.id.startsWith("custom-"));

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Documents & Legal</h1>
          <p className="text-sm text-slate-400 mt-0.5">Upload and manage all required compliance documents</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Progress pill */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-card">
            <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.round((uploadedCount / docs.length) * 100)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full rounded-full bg-emerald-500"
              />
            </div>
            <span className="text-xs font-semibold text-slate-600">
              {uploadedCount}/{docs.length} uploaded
            </span>
          </div>
          {/* Add custom button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-sm font-semibold text-white shadow-card-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Custom Doc
          </motion.button>
        </div>
      </div>

      {/* Core documents */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Required & Standard Documents</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coreDocs.map((doc, i) => (
            <motion.div key={doc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <DocCard doc={doc} onChange={handleChange} onRemoveFile={handleRemoveFile} />
            </motion.div>
          ))}
        </div>
      </div>

      {/* Custom documents */}
      <AnimatePresence>
        {customDocs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Custom Documents</p>
              <span className="text-xs text-slate-400">{customDocs.length} added</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {customDocs.map((doc) => (
                <div key={doc.id} className="relative">
                  <DocCard doc={doc} onChange={handleChange} onRemoveFile={handleRemoveFile} />
                  {/* Delete custom doc */}
                  <button
                    onClick={() => handleDeleteCustom(doc.id)}
                    className="absolute top-3 right-3 w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 flex items-center justify-center transition-colors"
                    aria-label="Delete custom document"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty custom hint */}
      {customDocs.length === 0 && (
        <button
          onClick={() => setShowModal(true)}
          className="w-full border-2 border-dashed border-slate-200 hover:border-brand-300 hover:bg-brand-50/50 rounded-2xl py-8 flex flex-col items-center gap-2 transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-brand-100 flex items-center justify-center transition-colors">
            <Plus className="w-5 h-5 text-slate-400 group-hover:text-brand-500 transition-colors" strokeWidth={1.8} />
          </div>
          <p className="text-sm font-semibold text-slate-500 group-hover:text-brand-600 transition-colors">Add a custom document</p>
          <p className="text-xs text-slate-300">Trade License, FSSAI, ISO Cert, etc.</p>
        </button>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <AddCustomModal onAdd={handleAddCustom} onClose={() => setShowModal(false)} />
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
