import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Upload, CheckCircle2, Clock, AlertTriangle,
  Plus, X, Trash2, Eye, Hash, Calendar,
  FileBadge, CreditCard, Store, GraduationCap,
  Banknote, ShieldCheck, Save, Loader2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, getErrorMessage } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = "pending" | "uploaded" | "expired";

interface StoredDoc {
  id:              string;
  title:           string;
  docNumber:       string;
  expiryDate:      string;
  fileName:        string | null;
  fileStoragePath: string | null;
  /**
   * Upload row id — PERSISTED, and the thing that makes a saved document viewable
   * again. Signed URLs live 10 minutes and are deliberately not stored, so without
   * this id there is no way to mint a fresh link after a reload: the View action on
   * every previously-saved document was dead.
   */
  uploadId?:       string | null;
  fileSignedUrl?:  string | null;  // ephemeral — fetched on demand, never persisted
  status:          DocStatus;
  required?:       boolean;
}

interface DocEntry extends StoredDoc {
  icon: React.ElementType;
  pendingFile?: File | null;  // local-only, not persisted
}

// ─── Default doc templates (provides icon + required flag for known IDs) ──────

type DocTemplate = { id: string; title: string; icon: React.ElementType; required: boolean };

const DEFAULT_TEMPLATES: DocTemplate[] = [
  { id: "drug-license",  title: "Drug License",              icon: ShieldCheck,   required: true  },
  { id: "gst-cert",      title: "GST Certificate",           icon: FileText,      required: true  },
  { id: "pan",           title: "PAN Card",                  icon: CreditCard,    required: true  },
  { id: "aadhaar",       title: "Aadhaar Card",              icon: FileBadge,     required: false },
  { id: "shop-reg",      title: "Shop Registration",         icon: Store,         required: true  },
  { id: "pharma-cert",   title: "Pharmacist Certificate",    icon: GraduationCap, required: true  },
  { id: "bank-details",  title: "Cancelled Cheque / Bank",   icon: Banknote,      required: false },
];

function mergeWithTemplates(stored: StoredDoc[]): DocEntry[] {
  const storedMap = new Map(stored.map((d) => [d.id, d]));

  // Core docs — always show all templates, filled from stored data if present
  const core: DocEntry[] = DEFAULT_TEMPLATES.map((t) => {
    const s = storedMap.get(t.id);
    return {
      id:              t.id,
      title:           t.title,
      icon:            t.icon,
      required:        t.required,
      docNumber:       s?.docNumber       ?? "",
      expiryDate:      s?.expiryDate      ?? "",
      fileName:        s?.fileName        ?? null,
      fileStoragePath: s?.fileStoragePath ?? null,
      uploadId:        s?.uploadId        ?? null,
      fileSignedUrl:   null, // never stored; fetched on demand via uploadId
      status:          s?.status          ?? "pending",
    };
  });

  // Custom docs — any stored docs not in DEFAULT_TEMPLATES
  const coreIds = new Set(DEFAULT_TEMPLATES.map((t) => t.id));
  const custom: DocEntry[] = stored
    .filter((d) => !coreIds.has(d.id))
    .map((d) => ({ ...d, icon: FileText }));

  return [...core, ...custom];
}

function toStoredDocs(entries: DocEntry[]): StoredDoc[] {
  return entries.map(({ icon: _icon, pendingFile: _pf, fileSignedUrl: _fsUrl, ...rest }) => rest);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { label: string; cls: string; Icon: React.ElementType }> = {
    uploaded: { label: "Uploaded", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2  },
    pending:  { label: "Pending",  cls: "bg-amber-50   text-amber-700   border-amber-200",   Icon: Clock         },
    expired:  { label: "Expired",  cls: "bg-red-50     text-red-600     border-red-200",     Icon: AlertTriangle },
  };
  const { label, cls, Icon } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold", cls)}>
      <Icon className="w-2.5 h-2.5" strokeWidth={2.2} />{label}
    </span>
  );
}

// ─── Document card ────────────────────────────────────────────────────────────

function DocCard({
  doc,
  onChangeField,
  onFileSelected,
  onRemoveFile,
  onViewDoc,
  uploading,
}: {
  doc:            DocEntry;
  onChangeField:  (id: string, field: "docNumber" | "expiryDate", value: string) => void;
  onFileSelected: (id: string, file: File) => void;
  onRemoveFile:   (id: string) => void;
  onViewDoc:      (doc: DocEntry) => void;
  uploading:      boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const Icon    = doc.icon;

  const [numFocused, setNumFocused] = useState(false);
  const [expFocused, setExpFocused] = useState(false);

  const displayUrl = doc.pendingFile
    ? URL.createObjectURL(doc.pendingFile)
    : (doc.fileSignedUrl ?? null);

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-white rounded-2xl border shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-4",
        doc.status === "uploaded" ? "border-emerald-100" :
        doc.status === "expired"  ? "border-red-100"     : "border-slate-100",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
            doc.status === "uploaded" ? "bg-emerald-50" :
            doc.status === "expired"  ? "bg-red-50"     : "bg-slate-100",
          )}>
            <Icon
              className={cn(
                doc.status === "uploaded" ? "text-emerald-600" :
                doc.status === "expired"  ? "text-red-500"     : "text-slate-500",
              )}
              style={{ width: 18, height: 18 }} strokeWidth={1.8}
            />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{doc.title}</p>
            {doc.required && <p className="text-[10px] text-slate-400 mt-0.5">Required</p>}
          </div>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {/* Number + Expiry */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Document Number</label>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-50 transition-all duration-150",
            numFocused ? "border-blue-400 ring-1 ring-blue-200 bg-white" : "border-slate-200 hover:border-slate-300",
          )}>
            <Hash className={cn("w-3 h-3 flex-shrink-0", numFocused ? "text-blue-500" : "text-slate-400")} strokeWidth={1.8} />
            <input
              type="text" placeholder="Enter number" value={doc.docNumber}
              onChange={(e) => onChangeField(doc.id, "docNumber", e.target.value)}
              onFocus={() => setNumFocused(true)} onBlur={() => setNumFocused(false)}
              className="flex-1 text-xs text-slate-700 placeholder-slate-300 bg-transparent outline-none"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Expiry Date</label>
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-50 transition-all duration-150",
            expFocused ? "border-blue-400 ring-1 ring-blue-200 bg-white" : "border-slate-200 hover:border-slate-300",
          )}>
            <Calendar className={cn("w-3 h-3 flex-shrink-0", expFocused ? "text-blue-500" : "text-slate-400")} strokeWidth={1.8} />
            <input
              type="date" value={doc.expiryDate}
              onChange={(e) => onChangeField(doc.id, "expiryDate", e.target.value)}
              onFocus={() => setExpFocused(true)} onBlur={() => setExpFocused(false)}
              className="flex-1 text-xs text-slate-700 bg-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* File upload area */}
      <div>
        {doc.fileName || doc.pendingFile ? (
          <div className={cn(
            "flex items-center gap-2 px-3 py-2.5 rounded-xl border",
            doc.pendingFile ? "bg-blue-50 border-blue-200" : "bg-emerald-50 border-emerald-200",
          )}>
            <FileText className={cn("w-3.5 h-3.5 flex-shrink-0", doc.pendingFile ? "text-blue-600" : "text-emerald-600")} strokeWidth={1.8} />
            <span className={cn("flex-1 text-xs font-medium truncate", doc.pendingFile ? "text-blue-700" : "text-emerald-700")}>
              {doc.pendingFile ? doc.pendingFile.name : doc.fileName}
              {doc.pendingFile && <span className="ml-1 text-[9px] opacity-70">(unsaved)</span>}
            </span>
            <button onClick={() => { onRemoveFile(doc.id); if (fileRef.current) fileRef.current.value = ""; }}
              className={cn("transition-colors", doc.pendingFile ? "text-blue-400 hover:text-red-500" : "text-emerald-500 hover:text-red-500")}
              aria-label="Remove file">
              <X className="w-3.5 h-3.5" />
            </button>
            {/* Shown whenever there is something to view — either a just-picked local
                file or a saved one we can mint a fresh signed URL for. Previously it
                required an in-memory signed URL, so it vanished for every document
                after a reload. */}
            {(displayUrl || doc.uploadId) && (
              <button
                onClick={() => displayUrl
                  ? window.open(displayUrl, "_blank", "noopener,noreferrer")
                  : onViewDoc(doc)}
                className={cn("transition-colors", doc.pendingFile ? "text-blue-400 hover:text-blue-700" : "text-emerald-500 hover:text-emerald-700")}
                aria-label="View file">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl transition-all text-xs font-semibold text-slate-400 hover:text-blue-600 group disabled:opacity-40"
          >
            {uploading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Upload className="w-3.5 h-3.5 group-hover:text-blue-500 transition-colors" strokeWidth={1.8} />}
            Upload Document
          </button>
        )}
        <input
          ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(doc.id, f); }}
        />
        <p className="text-[10px] text-slate-300 mt-1.5 text-center">PDF, JPG, PNG · Max 5 MB</p>
      </div>
    </motion.div>
  );
}

// ─── Custom document modal ────────────────────────────────────────────────────

function AddCustomModal({ onAdd, onClose }: { onAdd: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-slate-800">Add Custom Document</p>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <input autoFocus type="text" placeholder="e.g. Trade License"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onAdd(name.trim()); }}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 text-sm text-slate-800 outline-none transition-all mb-5"
        />
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={() => { if (name.trim()) onAdd(name.trim()); }} disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white transition-colors disabled:opacity-40">
            Add Document
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [docs,       setDocs]       = useState<DocEntry[]>(mergeWithTemplates([]));
  const [showModal,  setShowModal]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [uploading,  setUploading]  = useState<string | null>(null); // docId being uploaded
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadError,  setLoadError]  = useState<string | null>(null);

  // ── Load from API ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.get("/pharmacy")
      .then(({ data }) => {
        const stored: StoredDoc[] = Array.isArray(data.data?.documents) ? data.data.documents : [];
        setDocs(mergeWithTemplates(stored));
        setLoadError(null);
      })
      .catch((err) => {
        // NOT silent, and Save is blocked while it stands.
        //
        // This previously fell back to empty templates with no indication. Saving
        // from that state PATCHes an empty document list over whatever was stored —
        // so one failed GET, and a pharmacy's drug licence and GST certificate
        // records are wiped by a user who thought they were filling in a blank form.
        setLoadError(getErrorMessage(err, "Could not load your documents."));
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Field change ──────────────────────────────────────────────────────────
  function handleChangeField(id: string, field: "docNumber" | "expiryDate", value: string) {
    setDocs((prev) => prev.map((d) => d.id !== id ? d : { ...d, [field]: value }));
  }

  // ── File selected: upload immediately to Supabase ─────────────────────────
  async function handleFileSelected(id: string, file: File) {
    // Optimistically store as pending
    setDocs((prev) => prev.map((d) => d.id !== id ? d : { ...d, pendingFile: file }));
    setUploading(id);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{
        data: { id: string; fileUrl: string; signedUrl: string | null; fileName: string };
      }>("/uploads/pharmacy-document", fd);
      setDocs((prev) => prev.map((d) =>
        d.id !== id ? d : {
          ...d,
          pendingFile:     null,
          fileName:        data.data.fileName,
          fileStoragePath: data.data.fileUrl,
          uploadId:        data.data.id,
          fileSignedUrl:   data.data.signedUrl,
          status:          "uploaded" as DocStatus,
        },
      ));
    } catch (err) {
      // Revert the optimistic update AND say why. This used to fail completely
      // silently: the row simply reverted, so a 10MB-limit or wrong-file-type
      // rejection — both of which the API names precisely — looked like nothing
      // had happened at all.
      setDocs((prev) => prev.map((d) => d.id !== id ? d : { ...d, pendingFile: null }));
      setUploadError(getErrorMessage(err, "Could not upload that file. Please try again."));
    } finally {
      setUploading(null);
    }
  }

  /**
   * Mints a fresh signed URL for an already-saved document.
   *
   * Stored docs carry only an `uploadId`; the 10-minute signed URL is never
   * persisted, so viewing one after a reload requires asking for a new link.
   */
  async function handleViewDoc(doc: DocEntry) {
    if (doc.fileSignedUrl) { window.open(doc.fileSignedUrl, "_blank", "noopener"); return; }
    if (!doc.uploadId) {
      setUploadError("This document was saved before file links were tracked. Please re-upload it.");
      return;
    }
    setUploadError(null);
    try {
      const { data } = await api.get<{ data: { signedUrl: string } }>(`/uploads/${doc.uploadId}/signed-url`);
      setDocs((prev) => prev.map((d) => d.id !== doc.id ? d : { ...d, fileSignedUrl: data.data.signedUrl }));
      window.open(data.data.signedUrl, "_blank", "noopener");
    } catch (err) {
      setUploadError(getErrorMessage(err, "Could not open that document. Please try again."));
    }
  }

  // ── Remove file ───────────────────────────────────────────────────────────
  function handleRemoveFile(id: string) {
    setDocs((prev) => prev.map((d) => d.id !== id ? d : {
      ...d,
      pendingFile:     null,
      fileName:        null,
      fileStoragePath: null,
      fileSignedUrl:   null,
      status:          "pending" as DocStatus,
    }));
  }

  // ── Add custom doc ────────────────────────────────────────────────────────
  function handleAddCustom(name: string) {
    const newDoc: DocEntry = {
      id:              `custom-${Date.now()}`,
      title:           name,
      icon:            FileText,
      docNumber:       "",
      expiryDate:      "",
      fileName:        null,
      fileStoragePath: null,
      fileSignedUrl:   null,
      status:          "pending",
      required:        false,
    };
    setDocs((prev) => [...prev, newDoc]);
    setShowModal(false);
  }

  // ── Delete custom doc ─────────────────────────────────────────────────────
  function handleDeleteCustom(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  // ── Save to API ───────────────────────────────────────────────────────────
  async function handleSave() {
    // Refuse to save on top of a failed load — see the loadError comment above.
    if (loadError) {
      setSaveError("Can't save while your existing documents failed to load — reload the page first.");
      return;
    }
    setSaving(true); setSaveError(null);
    try {
      await api.patch("/pharmacy/documents", { documents: toStoredDocs(docs) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      // Surfaces the server's reason — notably 403 for a staff member without
      // OWNER/MANAGER, which "Failed to save" gave no hint of.
      setSaveError(getErrorMessage(err, "Failed to save. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const uploadedCount = docs.filter((d) => d.status === "uploaded").length;
  const coreDocs      = docs.filter((d) => DEFAULT_TEMPLATES.some((t) => t.id === d.id));
  const customDocs    = docs.filter((d) => !DEFAULT_TEMPLATES.some((t) => t.id === d.id));

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Documents & Legal</h1>
            <p className="text-sm text-slate-400 mt-0.5">Compliance documents stored securely and accessible anytime</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Progress pill */}
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
              <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <motion.div
                  animate={{ width: `${Math.round((uploadedCount / docs.length) * 100)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-full rounded-full bg-emerald-500"
                />
              </div>
              <span className="text-xs font-semibold text-slate-600">{uploadedCount}/{docs.length} uploaded</span>
            </div>

            {/* Load / upload failures. Both used to be invisible: a failed GET left an
                empty form that could overwrite stored documents on save, and a rejected
                file just quietly disappeared from its row. */}
            {loadError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{loadError} Saving is disabled — reload the page to try again.</span>
              </div>
            )}
            {uploadError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{uploadError}</span>
                <button onClick={() => setUploadError(null)} className="ml-auto text-red-400 hover:text-red-600" aria-label="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Save button */}
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait">
                {saved && (
                  <motion.span key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                  </motion.span>
                )}
                {saveError && (
                  <motion.span key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-[12px] text-red-500">
                    <AlertCircle className="w-3 h-3" /> {saveError}
                  </motion.span>
                )}
              </AnimatePresence>
              <button onClick={handleSave} disabled={saving || !!loadError}
                title={loadError ? "Reload the page before saving" : undefined}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.97]">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>

            {/* Add custom */}
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 active:scale-[0.97] text-sm font-semibold text-white shadow-sm transition-all">
              <Plus className="w-3.5 h-3.5" />Add Doc
            </button>
          </div>
        </div>

        {/* Core documents */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Required & Standard</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {coreDocs.map((doc, i) => (
              <motion.div key={doc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <DocCard
                  doc={doc}
                  onChangeField={handleChangeField}
                  onFileSelected={handleFileSelected}
                  onRemoveFile={handleRemoveFile}
                  onViewDoc={handleViewDoc}
                  uploading={uploading === doc.id}
                />
              </motion.div>
            ))}
          </div>
        </div>

        {/* Custom documents */}
        <AnimatePresence>
          {customDocs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Custom Documents</p>
                <span className="text-xs text-slate-400">{customDocs.length} added</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customDocs.map((doc) => (
                  <div key={doc.id} className="relative">
                    <DocCard
                      doc={doc}
                      onChangeField={handleChangeField}
                      onFileSelected={handleFileSelected}
                      onRemoveFile={handleRemoveFile}
                  onViewDoc={handleViewDoc}
                      uploading={uploading === doc.id}
                    />
                    <button
                      onClick={() => handleDeleteCustom(doc.id)}
                      className="absolute top-3 right-3 w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 flex items-center justify-center transition-colors"
                      aria-label="Delete">
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
          <button onClick={() => setShowModal(true)}
            className="w-full border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 rounded-2xl py-8 flex flex-col items-center gap-2 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
              <Plus className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" strokeWidth={1.8} />
            </div>
            <p className="text-sm font-semibold text-slate-500 group-hover:text-blue-600 transition-colors">Add a custom document</p>
            <p className="text-xs text-slate-300">Trade License, FSSAI, ISO Cert, etc.</p>
          </button>
        )}

        {/* Modal */}
        <AnimatePresence>
          {showModal && <AddCustomModal onAdd={handleAddCustom} onClose={() => setShowModal(false)} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
