import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, ArrowRight, ArrowLeft, Check, AlertTriangle,
  Info, RefreshCw, FileSpreadsheet, Download,
  Loader2, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

// ── API ───────────────────────────────────────────────────────────────────────
// Uses the shared axios instance — correct base URL (port 4000), Bearer token,
// and silent token-refresh are all handled automatically.

async function apiFetch<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = opts;
  try {
    const res = await api.request<{ success: boolean; data: T; error?: string }>({
      method,
      url: `/migration${path}`,
      data: body,
    });
    if (!res.data.success) throw new Error(res.data.error ?? "Request failed");
    return res.data.data;
  } catch (err: any) {
    // Prefer the server's own error message over the generic Axios HTTP-level one
    const serverMsg = err?.response?.data?.error ?? err?.response?.data?.message;
    if (serverMsg) throw new Error(serverMsg);
    if (err?.code === "ECONNABORTED" || err?.message?.includes("timeout")) {
      throw new Error("Request timed out — the server may be busy. Please retry.");
    }
    if (err?.message === "Network Error") {
      throw new Error("Cannot reach the server — check your connection and retry.");
    }
    throw err;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step =
  | "start"
  | "upload"
  | "column-map"
  | "medicine-map"
  | "validation"
  | "commit-inventory"
  | "other-entities"
  | "summary";

interface Session {
  id:             string;
  status:         string;
  sourceSoftware?: string;
  completedSteps: string[];
  currentStep?:   string;
  columnMappings?: Record<string, string>;
  importJobs:     ImportJob[];
}

interface ImportJob {
  id:          string;
  entityType:  string;
  status:      string;
  totalRows:   number;
  successRows: number;
  failedRows:  number;
  errors:      IssueRow[];
}

interface IssueRow {
  row:      number;
  field?:   string;
  message:  string;
  severity: "error" | "warning";
}

interface ColumnDetection {
  csvHeader:      string;
  suggestedField: string | null;
  confidence:     "high" | "medium" | "low" | "none";
}

interface MedicineSuggestion {
  csvValue:    string;
  suggestions: { medicineId: string; name: string; manufacturer?: string; confidence: number }[];
  existingMapping?: { medicineId: string | null; isNew: boolean };
}

// ── CSV templates ─────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, { filename: string; content: string }> = {
  inventory: {
    filename: "inventory_template.csv",
    content: [
      "medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate,gstRate,manufacturer,hsnCode",
      "Paracetamol 500mg,BATCH001,12/2026,100,8.00,4.50,12,Sun Pharma,30049099",
      "",
    ].join("\n"),
  },
  suppliers: {
    filename: "suppliers_template.csv",
    content: [
      "supplierName,gstin,phone,email,address,city,state,creditDays,openingBalance",
      "ABC Distributors,27AABCA1234Z1Z5,9876543210,abc@dist.com,123 MG Road,Mumbai,MH,30,15000",
      "",
    ].join("\n"),
  },
  customers: {
    filename: "customers_template.csv",
    content: [
      "customerName,phone,email,address,dateOfBirth,gender,creditLimit",
      "Raj Kumar,9876543210,raj@email.com,45 Park St,15/08/1985,Male,5000",
      "",
    ].join("\n"),
  },
  doctors: {
    filename: "doctors_template.csv",
    content: [
      "doctorName,registrationNo,specialty,clinic,phone",
      "Dr. A Sharma,MCI-12345,General Physician,City Clinic,9876543210",
      "",
    ].join("\n"),
  },
};

function downloadTemplate(key: string) {
  const t    = TEMPLATES[key]!;
  const blob = new Blob([t.content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = t.filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = ["Marg ERP", "Busy", "GoFrugal", "RetailGraph", "RedBook", "Tally", "Other"];

// Fields that MUST be mapped for inventory import to succeed.
// Without medicineName the medicine-mapping step is pointless (0% success rate).
const REQUIRED_INVENTORY_FIELDS = ["medicineName", "batchNumber", "expiryDate", "quantity", "mrp", "purchaseRate"] as const;

const CANONICAL_FIELDS = [
  "(skip)",
  "medicineName", "batchNumber", "expiryDate", "quantity", "mrp", "purchaseRate",
  "gstRate", "manufacturer", "hsnCode", "minimumStock",
  "supplierName", "gstin", "dlNumber", "phone", "email", "address", "city", "state",
  "creditDays", "openingBalance",
  "customerName", "dateOfBirth", "gender", "creditLimit", "openingDue", "abhaNumber",
  "cardNumber", "notes",
  "doctorName", "registrationNo", "specialty", "clinic",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanMappings(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && v !== "(skip)"));
}

function parseCsvHeaders(text: string): string[] {
  const line = text.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  const del  = (line.match(/\t/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? "\t" : ",";
  return line.split(del).map((h) => h.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({ current, steps }: { current: Step; steps: { key: Step; label: string }[] }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center flex-shrink-0">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors",
            i < idx   ? "bg-green-500 border-green-500 text-white"
            : i === idx ? "bg-brand-600 border-brand-600 text-white"
            :             "bg-white border-slate-300 text-slate-400",
          )}>
            {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
          </div>
          <span className={cn(
            "ml-1.5 text-[11px] font-medium hidden sm:block whitespace-nowrap",
            i === idx ? "text-brand-700" : i < idx ? "text-green-600" : "text-slate-400",
          )}>
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div className={cn("mx-2 h-px w-5 sm:w-8 flex-shrink-0", i < idx ? "bg-green-400" : "bg-slate-200")} />
          )}
        </div>
      ))}
    </div>
  );
}

function CsvDropZone({ onText, label }: { onText: (t: string) => void; label: string }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      onText((e.target?.result as string) ?? "");
      setFileName(file.name);
    };
    reader.readAsText(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files[0]; if (f) readFile(f);
      }}
      onClick={() => fileRef.current?.click()}
      className={cn(
        "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors select-none",
        dragging  ? "border-brand-400 bg-brand-50"
        : fileName ? "border-green-400 bg-green-50"
        :            "border-slate-300 hover:border-brand-400 hover:bg-brand-50/30",
      )}
    >
      <input
        ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
      />
      {fileName ? (
        <>
          <Check className="w-6 h-6 text-green-500 mx-auto mb-1" />
          <p className="text-[13px] font-semibold text-green-700">{fileName}</p>
          <p className="text-[11px] text-green-500 mt-0.5">Click to replace</p>
        </>
      ) : (
        <>
          <FileSpreadsheet className="w-6 h-6 text-slate-400 mx-auto mb-1" />
          <p className="text-[13px] font-semibold text-slate-600">Drop .csv file or click to browse</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
        </>
      )}
    </div>
  );
}

function ColMappingTable({
  cols,
  mappings,
  onChange,
}: {
  cols:     ColumnDetection[];
  mappings: Record<string, string>;
  onChange: (header: string, value: string) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-slate-600 w-1/3">CSV Column</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600 w-1/2">Maps To</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cols.map((col) => (
            <tr key={col.csvHeader}>
              <td className="px-3 py-2 font-mono text-slate-700 text-[11px]">{col.csvHeader}</td>
              <td className="px-3 py-2">
                <select
                  value={mappings[col.csvHeader] ?? "(skip)"}
                  onChange={(e) => onChange(col.csvHeader, e.target.value)}
                  className="border border-slate-200 rounded px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 w-full max-w-[200px]"
                >
                  {CANONICAL_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </td>
              <td className="px-3 py-2">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-semibold",
                  col.confidence === "high"   ? "bg-green-100 text-green-700"
                  : col.confidence === "medium" ? "bg-yellow-100 text-yellow-700"
                  : col.confidence === "low"    ? "bg-orange-100 text-orange-700"
                  :                              "bg-slate-100 text-slate-400",
                )}>
                  {col.confidence}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const toast = useToast();
  const qc    = useQueryClient();

  // ── Wizard state ──────────────────────────────────────────────────────────

  const [step,           setStep]           = useState<Step>("start");
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [sourceSoftware, setSourceSoftware] = useState("Marg ERP");

  // Inventory CSV
  const [csvText,       setCsvText]       = useState("");
  const [detectedCols,  setDetectedCols]  = useState<ColumnDetection[]>([]);
  const [columnMappings,setColumnMappings]= useState<Record<string, string>>({});

  // Medicine mapping
  const [medSuggestions,   setMedSuggestions]   = useState<MedicineSuggestion[]>([]);
  const [confirmedMedMaps, setConfirmedMedMaps] = useState<Record<string, { medicineId?: string; isNew: boolean }>>({});

  // Validation + commit
  const [previewResult,   setPreviewResult]   = useState<any>(null);
  const [commitResult,    setCommitResult]    = useState<any>(null);
  // True while a secondary apiFetch runs inside an onSuccess callback (no mutation spinner for those)
  const [isFetchingNext, setIsFetchingNext]   = useState(false);

  // Other entities
  const [activeEntity,   setActiveEntity]   = useState<"suppliers" | "customers" | "doctors">("suppliers");
  const [entityCsvTexts, setEntityCsvTexts] = useState<Record<string, string>>({});
  // All CSV headers detected (including `none` confidence) — used to render the mapping table
  const [entityAllCols,  setEntityAllCols]  = useState<Record<string, ColumnDetection[]>>({});
  // User-confirmed column mappings (header → canonical field) — excludes "(skip)"
  const [entityColMaps,  setEntityColMaps]  = useState<Record<string, Record<string, string>>>({});
  const [entityResults,  setEntityResults]  = useState<Record<string, any>>({});

  // ── Live session polling (for async large imports) ────────────────────────

  // Issue 40: Restore sessionId on page refresh so background imports stay reconnected
  useEffect(() => {
    if (sessionId) return;
    const saved = sessionStorage.getItem("migration_session_id");
    if (saved) setSessionId(saved);
  }, []);

  useEffect(() => {
    if (sessionId) sessionStorage.setItem("migration_session_id", sessionId);
    else           sessionStorage.removeItem("migration_session_id");
  }, [sessionId]);

  const { data: session, isError: sessionQueryFailed } = useQuery<Session>({
    queryKey:        ["migration-session", sessionId],
    queryFn:         () => apiFetch(`/sessions/${sessionId}`),
    enabled:         !!sessionId,
    retry:           2,
    throwOnError:    false,
    refetchInterval: (q) => {
      const processing = q.state.data?.importJobs.some((j: ImportJob) => j.status === "PROCESSING");
      return processing ? 3000 : false;
    },
  });

  // Show a toast if the session polling permanently fails (e.g. network drop)
  useEffect(() => {
    if (sessionQueryFailed && sessionId) {
      toast.error("Lost connection to migration session — import status may be stale. Refresh to reconnect.");
    }
  }, [sessionQueryFailed, sessionId]);

  // Warn before leaving while an import is actively running
  useEffect(() => {
    const hasActiveImport = session?.importJobs.some((j) => j.status === "PROCESSING");
    if (!hasActiveImport) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session?.importJobs]);

  // Auto-advance from commit-inventory → other-entities when an async background
  // job finishes. Use jobId (not entityType) so multiple sessions don't cross-match.
  useEffect(() => {
    if (step !== "commit-inventory") return;
    // Only activate for async jobs (sync jobs set commitResult directly in onSuccess)
    if (!commitResult?.jobId) return;
    const inventoryJob = session?.importJobs.find((j) => j.id === commitResult.jobId);
    if (inventoryJob?.status === "COMPLETED" || inventoryJob?.status === "FAILED") {
      setCommitResult({
        entityType:  "INVENTORY",
        totalRows:   inventoryJob.totalRows,
        successRows: inventoryJob.successRows,
        failedRows:  inventoryJob.failedRows,
        errors:      inventoryJob.errors ?? [],
        async:       false,
      });
    }
  }, [session?.importJobs, step, commitResult?.jobId]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createSession = useMutation({
    mutationFn: () => apiFetch<Session>("/sessions", {
      method: "POST", body: { sourceSoftware },
    }),
    onSuccess: (s) => { setSessionId(s.id); setStep("upload"); },
    onError:   (e: Error) => toast.error(e.message),
  });

  const detectColumns = useMutation({
    mutationFn: (headers: string[]) => apiFetch<ColumnDetection[]>("/detect-columns", {
      method: "POST", body: { headers },
    }),
    onSuccess: (cols) => {
      setDetectedCols(cols);
      const m: Record<string, string> = {};
      cols.forEach((c) => { if (c.suggestedField && c.confidence !== "none") m[c.csvHeader] = c.suggestedField; });
      setColumnMappings(m);
      setStep("column-map");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveColMappings = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No active session — please refresh and start migration again.");
      const clean = cleanMappings(columnMappings);
      return apiFetch(`/sessions/${sessionId}/column-mappings`, {
        method: "PATCH", body: { mappings: clean },
      });
    },
    onSuccess: async () => {
      setIsFetchingNext(true);
      const clean = cleanMappings(columnMappings);
      try {
        const result = await apiFetch<MedicineSuggestion[]>(`/sessions/${sessionId}/medicine-suggestions`, {
          method: "POST", body: { csvText, columnMappings: clean },
        });
        setMedSuggestions(result);
        // Pre-select best suggestions
        const initial: typeof confirmedMedMaps = {};
        result.forEach((s) => {
          if (s.existingMapping) {
            initial[s.csvValue] = {
              medicineId: s.existingMapping.medicineId ?? undefined,
              isNew:      s.existingMapping.isNew,
            };
          } else if (s.suggestions.length > 0) {
            initial[s.csvValue] = { medicineId: s.suggestions[0]!.medicineId, isNew: false };
          }
        });
        setConfirmedMedMaps(initial);
        setStep("medicine-map");
      } catch (e: any) {
        toast.error(e.message ?? "Failed to fetch medicine suggestions");
      } finally {
        setIsFetchingNext(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMedicineMaps = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No active session — please refresh and start migration again.");
      const mappings = medSuggestions.map((s) => {
        const conf = confirmedMedMaps[s.csvValue];
        return { csvValue: s.csvValue, medicineId: conf?.medicineId, isNew: conf?.isNew ?? true };
      });
      return apiFetch(`/sessions/${sessionId}/medicine-mappings`, {
        method: "POST", body: { mappings },
      });
    },
    onSuccess: async () => {
      setIsFetchingNext(true);
      const clean = cleanMappings(columnMappings);
      try {
        const preview = await apiFetch(`/sessions/${sessionId}/preview/inventory`, {
          method: "POST", body: { csvText, columnMappings: clean },
        });
        setPreviewResult(preview);
        setStep("validation");
      } catch (e: any) {
        toast.error(e.message ?? "Failed to run validation");
      } finally {
        setIsFetchingNext(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commitInventory = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No active session — please refresh and start migration again.");
      const clean = cleanMappings(columnMappings);
      return apiFetch(`/sessions/${sessionId}/commit/inventory`, {
        method: "POST", body: { csvText, columnMappings: clean },
      });
    },
    onSuccess: (result) => {
      setCommitResult(result);
      qc.invalidateQueries({ queryKey: ["migration-session", sessionId] });
      // Stay on commit-inventory step so the user sees the result card.
      // The "Continue" button inside commit-inventory advances to step 7.
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commitEntity = useMutation({
    mutationFn: (entity: "suppliers" | "customers" | "doctors") => {
      if (!sessionId) throw new Error("No active session — please refresh and start migration again.");
      const clean = cleanMappings(entityColMaps[entity] ?? {});
      return apiFetch(`/sessions/${sessionId}/commit/${entity}`, {
        method: "POST",
        body: { csvText: entityCsvTexts[entity] ?? "", columnMappings: clean },
      });
    },
    onSuccess: (result, entity) => {
      setEntityResults((p) => ({ ...p, [entity]: result }));
      qc.invalidateQueries({ queryKey: ["migration-session", sessionId] });
      toast.success(`${entity.charAt(0).toUpperCase() + entity.slice(1)} imported successfully`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeSession = useMutation({
    mutationFn: () => apiFetch(`/sessions/${sessionId}/complete`, { method: "POST" }),
    onSuccess:  () => {
      sessionStorage.removeItem("migration_session_id");
      qc.invalidateQueries({ queryKey: ["migration-session", sessionId] });
      setStep("summary");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── CSV handlers ──────────────────────────────────────────────────────────

  function handleInventoryCsvLoaded(text: string) {
    const headers = parseCsvHeaders(text);
    if (headers.length === 0) {
      toast.error("No columns detected — please upload a valid CSV file.");
      return;
    }
    setCsvText(text);
    detectColumns.mutate(headers);
  }

  async function handleEntityCsvLoaded(entity: string, text: string) {
    const headers = parseCsvHeaders(text);
    if (headers.length === 0) {
      toast.error("No columns detected — please upload a valid CSV file.");
      return;
    }
    setEntityCsvTexts((p) => ({ ...p, [entity]: text }));
    try {
      const cols = await apiFetch<ColumnDetection[]>("/detect-columns", {
        method: "POST", body: { headers },
      });
      setEntityAllCols((p) => ({ ...p, [entity]: cols }));
      const m: Record<string, string> = {};
      cols.forEach((c) => { if (c.suggestedField && c.confidence !== "none") m[c.csvHeader] = c.suggestedField; });
      setEntityColMaps((p) => ({ ...p, [entity]: m }));
    } catch (e: any) {
      // Column detection failed — clear the CSV so the Import button doesn't appear
      // with empty column mappings (which would fail all rows silently).
      setEntityCsvTexts((p) => ({ ...p, [entity]: "" }));
      toast.error(`Could not read ${entity} CSV: ${e?.message ?? "unknown error"}`);
    }
  }

  // ── Steps config ──────────────────────────────────────────────────────────

  const STEPS: { key: Step; label: string }[] = [
    { key: "start",            label: "Start"     },
    { key: "upload",           label: "Upload"    },
    { key: "column-map",       label: "Columns"   },
    { key: "medicine-map",     label: "Medicines" },
    { key: "validation",       label: "Validate"  },
    { key: "commit-inventory", label: "Inventory" },
    { key: "other-entities",   label: "Others"    },
    { key: "summary",          label: "Done"      },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Migrate from Another Software</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Import your inventory, suppliers, customers and doctors — step by step.
        </p>
      </div>

      <StepIndicator current={step} steps={STEPS} />

      {/* ── Step 1: Source selection ────────────────────────────────────────── */}
      {step === "start" && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">Where are you migrating from?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt} type="button"
                onClick={() => setSourceSoftware(opt)}
                className={cn(
                  "border-2 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                  sourceSoftware === opt
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-600 hover:border-brand-300",
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-[12px] text-blue-800 space-y-1">
            <p className="font-semibold">What you'll need:</p>
            <p>• Stock report exported as CSV from {sourceSoftware}</p>
            <p>• Supplier list (optional)</p>
            <p>• Customer / patient list (optional)</p>
            <p>• Doctor list (optional)</p>
          </div>

          <button
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Start Migration <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Step 2: Upload inventory CSV ────────────────────────────────────── */}
      {step === "upload" && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Upload Inventory CSV</h2>
            <button
              onClick={() => { try { downloadTemplate("inventory"); } catch { toast.error("Could not generate template file"); } }}
              className="flex items-center gap-1.5 text-[12px] text-brand-600 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg font-medium"
            >
              <Download className="w-3.5 h-3.5" /> Download Template
            </button>
          </div>

          <CsvDropZone
            onText={handleInventoryCsvLoaded}
            label="Export: Reports → Stock Summary → Export CSV"
          />

          {detectColumns.isPending && (
            <div className="flex items-center gap-2 text-[12px] text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Detecting columns…
            </div>
          )}

          <div>
            <p className="text-[11px] text-slate-400 mb-1">Or paste CSV content directly:</p>
            <textarea
              placeholder="Paste CSV rows here…"
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
              onChange={(e) => {
                const v = e.target.value;
                if (v.includes("\n")) handleInventoryCsvLoaded(v);
              }}
            />
          </div>
        </div>
      )}

      {/* ── Step 3: Column mapping ───────────────────────────────────────────── */}
      {step === "column-map" && (
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
          {/* Header — fixed */}
          <div className="px-6 pt-6 pb-3 flex-shrink-0">
            <h2 className="font-semibold text-slate-800 mb-1">Map Your CSV Columns</h2>
            <p className="text-[12px] text-slate-500">
              We've auto-detected most columns. Correct any that are wrong, and set unknown ones to{" "}
              <code className="bg-slate-100 px-1 rounded">(skip)</code>.
            </p>
          </div>

          {/* Scrollable table */}
          <div className="flex-1 overflow-y-auto px-6 pb-2">
            <ColMappingTable
              cols={detectedCols}
              mappings={columnMappings}
              onChange={(header, value) =>
                setColumnMappings((p) => ({ ...p, [header]: value }))
              }
            />
          </div>

          {/* Footer — fixed at bottom of card */}
          {(() => {
            const mappedValues     = new Set(Object.values(columnMappings));
            const missingRequired  = REQUIRED_INVENTORY_FIELDS.filter((f) => !mappedValues.has(f));
            const canProceed       = !missingRequired.includes("medicineName");
            return (
              <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-xl space-y-3">
                {missingRequired.length > 0 && (
                  <div className={cn(
                    "rounded-lg px-3 py-2 text-[11px] flex items-start gap-1.5",
                    !canProceed
                      ? "bg-red-50 border border-red-200 text-red-800"
                      : "bg-amber-50 border border-amber-200 text-amber-800",
                  )}>
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      {!canProceed
                        ? <><strong>medicineName is required</strong> — without it, 100% of rows will fail. Map the medicine name column before continuing.</>
                        : <>Required fields not yet mapped: <strong>{missingRequired.join(", ")}</strong>. Rows missing these will be skipped during import.</>
                      }
                    </span>
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setStep("upload")}
                    className="flex items-center gap-1.5 text-[13px] text-slate-600 border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg font-medium"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <button
                    onClick={() => saveColMappings.mutate()}
                    disabled={saveColMappings.isPending || isFetchingNext || !canProceed}
                    className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {(saveColMappings.isPending || isFetchingNext) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Next: Map Medicines <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Step 4: Medicine mapping ─────────────────────────────────────────── */}
      {step === "medicine-map" && (
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
          <div className="px-6 pt-6 pb-3 flex-shrink-0">
            <h2 className="font-semibold text-slate-800 mb-1">Map Medicines to Catalog</h2>
            <p className="text-[12px] text-slate-500">
              Confirm how each medicine from your old software maps to our catalog.
              Previously confirmed medicines are pre-filled.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-2">
          {medSuggestions.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-slate-400">
              No medicines found in the CSV — check your column mapping for <code>medicineName</code>.
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {medSuggestions.map((s) => {
                const confirmed   = confirmedMedMaps[s.csvValue];
                const isExisting  = !!s.existingMapping;
                const isConfirmed = !!confirmed;

                return (
                  <div
                    key={s.csvValue}
                    className={cn(
                      "border rounded-lg p-3",
                      isExisting  ? "border-green-200 bg-green-50"
                      : isConfirmed ? "border-brand-200 bg-brand-50/40"
                      :              "border-slate-200",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-mono font-semibold text-slate-700">{s.csvValue}</span>
                      <div className="flex items-center gap-1.5">
                        {isExisting && (
                          <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                            Previously mapped
                          </span>
                        )}
                        {isConfirmed && (
                          <Check className="w-3.5 h-3.5 text-brand-500" />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.suggestions.map((match) => (
                        <button
                          key={match.medicineId} type="button"
                          onClick={() =>
                            setConfirmedMedMaps((p) => ({
                              ...p,
                              [s.csvValue]: { medicineId: match.medicineId, isNew: false },
                            }))
                          }
                          className={cn(
                            "text-[11px] border rounded-lg px-2.5 py-1.5 text-left transition-colors",
                            confirmed?.medicineId === match.medicineId
                              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
                              : "border-slate-200 text-slate-600 hover:border-brand-300",
                          )}
                        >
                          <span className="font-medium">{match.name}</span>
                          {match.manufacturer && (
                            <span className="text-slate-400 ml-1">· {match.manufacturer}</span>
                          )}
                          <span className={cn(
                            "ml-1.5 text-[9px] rounded-full px-1.5 py-0.5 font-bold",
                            match.confidence > 0.8 ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700",
                          )}>
                            {Math.round(match.confidence * 100)}%
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmedMedMaps((p) => ({ ...p, [s.csvValue]: { isNew: true } }))
                        }
                        className={cn(
                          "text-[11px] border rounded-lg px-2.5 py-1.5 transition-colors",
                          confirmed?.isNew
                            ? "border-amber-500 bg-amber-50 text-amber-700 font-semibold"
                            : "border-dashed border-slate-300 text-slate-500 hover:border-amber-400",
                        )}
                      >
                        + Create New Medicine
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          </div>

          <div className="px-6 py-3 border-t border-slate-100 flex-shrink-0">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Medicines marked "Create New" will be added to the global catalog — they'll appear for all pharmacies on the platform.</span>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 flex gap-3 flex-shrink-0 bg-white rounded-b-xl">
            <button
              onClick={() => setStep("column-map")}
              className="flex items-center gap-1.5 text-[13px] text-slate-600 border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => confirmMedicineMaps.mutate()}
              disabled={
                confirmMedicineMaps.isPending ||
                isFetchingNext ||
                medSuggestions.length === 0 ||
                medSuggestions.some((s) => !confirmedMedMaps[s.csvValue])
              }
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {(confirmMedicineMaps.isPending || isFetchingNext) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm & Preview <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Validation report ────────────────────────────────────────── */}
      {step === "validation" && previewResult && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">Validation Report</h2>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Total Rows", value: previewResult.totalRows, color: "slate" },
              { label: "Valid Rows", value: previewResult.validRows, color: "green" },
              { label: "Error Rows", value: previewResult.errorRows, color: "red"   },
            ].map((stat) => (
              <div key={stat.label} className="border border-slate-200 rounded-lg p-3 text-center">
                <p className={cn(
                  "text-2xl font-bold",
                  stat.color === "green" ? "text-green-600"
                  : stat.color === "red" ? "text-red-500"
                  :                       "text-slate-800",
                )}>
                  {stat.value}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {previewResult.issues?.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden mb-5">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <p className="text-[12px] font-semibold text-slate-700">
                  Issues ({previewResult.issues.length})
                </p>
                {previewResult.issues.length > 100 && (
                  <p className="text-[10px] text-slate-400">Showing first 100</p>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                {(previewResult.issues as IssueRow[]).slice(0, 100).map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2">
                    {issue.severity === "error"
                      ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      : <Info         className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    }
                    <span className="text-[11px] text-slate-700">
                      <span className="font-semibold">Row {issue.row}</span>
                      {issue.field && <span className="text-slate-400"> [{issue.field}]</span>}
                      {" — "}{issue.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unmapped medicine warning — these rows will fail even though they're "valid" */}
          {previewResult.unmappedMedicines?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-800 mb-4 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>{previewResult.unmappedMedicines.length} medicine(s) have no mapping</strong> and will be skipped during import:{" "}
                {(previewResult.unmappedMedicines as string[]).slice(0, 3).join(", ")}
                {previewResult.unmappedMedicines.length > 3 && ` and ${previewResult.unmappedMedicines.length - 3} more`}.
                Go back to fix them.
              </span>
            </div>
          )}

          {previewResult.errorRows > 0 && previewResult.validRows > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[12px] text-blue-800 mb-4">
              <Info className="w-3.5 h-3.5 inline mr-1" />
              {previewResult.validRows} valid rows will be imported. The {previewResult.errorRows} error rows will be skipped.
            </div>
          )}

          {previewResult.validRows === 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[12px] text-red-800 mb-4">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              No valid rows found. Go back and check your column mapping and medicine mapping.
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("medicine-map")}
              className="flex items-center gap-1.5 text-[13px] text-slate-600 border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => { setStep("commit-inventory"); commitInventory.mutate(); }}
              disabled={commitInventory.isPending || previewResult.validRows === 0}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[13px] font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {commitInventory.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ShieldCheck className="w-4 h-4" />
              }
              Import {previewResult.validRows} Rows
            </button>
          </div>
        </div>
      )}

      {/* ── Step 6: Commit in progress / result ─────────────────────────────── */}
      {step === "commit-inventory" && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          {commitInventory.isPending ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-brand-600 mx-auto mb-3" />
              <p className="text-[14px] font-semibold text-slate-700">Importing inventory…</p>
              <p className="text-[12px] text-slate-400 mt-1">Please do not close this tab</p>
            </>
          ) : commitResult?.async ? (
            <>
              <RefreshCw className="w-10 h-10 text-brand-500 mx-auto mb-3 animate-spin" />
              <p className="text-[14px] font-semibold text-slate-700">Large import running in background</p>
              <p className="text-[12px] text-slate-400 mt-1">Job ID: <span className="font-mono">{commitResult.jobId}</span></p>
              <p className="text-[12px] text-slate-500 mt-2">You can safely continue — the page will poll until done.</p>
              {/* Auto-advance once the job is COMPLETED */}
              {session?.importJobs.some((j) => j.entityType === "INVENTORY" && j.status === "COMPLETED") && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-[12px] text-green-800">
                  <Check className="w-3.5 h-3.5 inline mr-1" />
                  Background import complete!
                </div>
              )}
              <button
                onClick={() => setStep("other-entities")}
                className="mt-4 flex items-center gap-2 mx-auto bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-5 py-2 rounded-lg"
              >
                Continue to Other Entities <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : commitResult ? (
            <>
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <Check className="w-7 h-7 text-green-600" />
              </div>
              <p className="text-[15px] font-bold text-slate-800">Inventory Imported</p>
              <p className="text-[13px] text-green-600 mt-1 font-medium">
                {commitResult.successRows} rows imported
                {commitResult.failedRows > 0 && ` · ${commitResult.failedRows} skipped`}
              </p>
              {commitResult.failedRows > 0 && (
                <div className="mt-3 max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-left">
                  {(commitResult.errors as IssueRow[]).slice(0, 50).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                      <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                      <span className="text-[10px] text-slate-600">Row {e.row}: {e.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setStep("other-entities")}
                className="mt-5 flex items-center gap-2 mx-auto bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-6 py-2.5 rounded-lg"
              >
                Continue to Other Entities <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* ── Step 7: Other entities ───────────────────────────────────────────── */}
      {step === "other-entities" && (
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>

          {/* Header + tabs — fixed */}
          <div className="px-6 pt-6 pb-3 flex-shrink-0">
            <h2 className="font-semibold text-slate-800 mb-1">Import Other Data</h2>
            <p className="text-[12px] text-slate-500 mb-4">
              All optional. Skip any you don't have or don't need to migrate.
            </p>
            <div className="flex gap-2">
              {(["suppliers", "customers", "doctors"] as const).map((e) => (
                <button
                  key={e}
                  onClick={() => setActiveEntity(e)}
                  className={cn(
                    "flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors capitalize",
                    activeEntity === e
                      ? "bg-brand-600 border-brand-600 text-white"
                      : entityResults[e]
                      ? "bg-green-50 border-green-300 text-green-700"
                      : "border-slate-200 text-slate-600 hover:border-brand-300",
                  )}
                >
                  {entityResults[e] && <Check className="w-3 h-3" />}
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">

            {/* Upload header */}
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-slate-700 capitalize">
                {activeEntity} CSV
              </p>
              <button
                onClick={() => { try { downloadTemplate(activeEntity); } catch { toast.error("Could not generate template file"); } }}
                className="flex items-center gap-1 text-[11px] text-brand-600 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-md font-medium"
              >
                <Download className="w-3 h-3" /> Template
              </button>
            </div>

            {/* Drop zone — key remounts on tab switch so filename/state resets */}
            <CsvDropZone
              key={activeEntity}
              onText={(t) => handleEntityCsvLoaded(activeEntity, t)}
              label={`Export ${activeEntity} list from ${sourceSoftware}`}
            />

            {/* Column mapping table — only shown after CSV is uploaded for this tab */}
            {entityAllCols[activeEntity] && entityAllCols[activeEntity]!.length > 0 && (
              <ColMappingTable
                cols={entityAllCols[activeEntity]!}
                mappings={entityColMaps[activeEntity] ?? {}}
                onChange={(header, value) =>
                  setEntityColMaps((p) => ({
                    ...p,
                    [activeEntity]: { ...(p[activeEntity] ?? {}), [header]: value },
                  }))
                }
              />
            )}

            {/* Success result for this entity */}
            {entityResults[activeEntity] && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-[12px] text-green-800">
                <Check className="w-3.5 h-3.5 inline mr-1" />
                <span className="font-semibold">{entityResults[activeEntity].successRows}</span>{" "}
                {activeEntity} imported
                {entityResults[activeEntity].failedRows > 0 && (
                  <span className="text-orange-600 ml-1">
                    · {entityResults[activeEntity].failedRows} skipped
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Footer buttons — always visible */}
          <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0 bg-white rounded-b-xl">
            {entityCsvTexts[activeEntity] && !entityResults[activeEntity] && (
              <button
                onClick={() => commitEntity.mutate(activeEntity)}
                disabled={commitEntity.isPending}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {commitEntity.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Upload className="w-4 h-4" />
                }
                Import {activeEntity}
              </button>
            )}
            <button
              onClick={() => {
                const hasImported = Object.values(entityResults).some(Boolean);
                if (!hasImported) {
                  if (!window.confirm(
                    "You haven't imported any suppliers, customers or doctors.\n\n" +
                    "These can be imported later. Continue to complete the migration?"
                  )) return;
                }
                completeSession.mutate();
              }}
              disabled={completeSession.isPending}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[13px] font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {completeSession.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ShieldCheck className="w-4 h-4" />
              }
              Complete Migration
            </button>
            <span className="text-[11px] text-slate-400 ml-auto">
              All optional — skip any you don't have
            </span>
          </div>
        </div>
      )}

      {/* ── Step 8: Summary ──────────────────────────────────────────────────── */}
      {step === "summary" && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          {/* Background job still running — show spinner instead of success icon */}
          {session?.importJobs.some((j) => j.status === "PROCESSING") ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-brand-600 mx-auto mb-3" />
              <h2 className="text-lg font-bold text-slate-900 mb-1">Finishing Import…</h2>
              <p className="text-[13px] text-slate-500 mb-6">
                Your inventory is still being imported in the background. This page will update automatically.
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Migration Complete</h2>
              <p className="text-[13px] text-slate-500 mb-6">
                Your pharmacy data has been imported successfully from {sourceSoftware}.
              </p>
            </>
          )}

          {session && session.importJobs.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 max-w-lg mx-auto">
              {session.importJobs.map((job) => (
                <div key={job.id} className="border border-slate-200 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-slate-800">{job.successRows}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 capitalize">
                    {job.entityType.toLowerCase()}
                  </p>
                  {job.failedRows > 0 && (
                    <p className="text-[10px] text-orange-500 mt-0.5">{job.failedRows} skipped</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-center gap-3">
            <Link
              to="/dashboard/inventory"
              className="text-[13px] font-semibold text-brand-600 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-4 py-2 rounded-lg"
            >
              View Inventory
            </Link>
            <Link
              to="/dashboard"
              className="text-[13px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      )}

      {/* ── Session status bar ───────────────────────────────────────────────── */}
      {sessionId && step !== "start" && step !== "summary" && (
        <div className="mt-4 border border-slate-100 bg-slate-50 rounded-lg px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-slate-400">
          <span>Session: <span className="font-mono text-slate-600">{sessionId.slice(0, 14)}…</span></span>
          <span>Source: <span className="text-slate-600">{sourceSoftware}</span></span>
          {session?.completedSteps && session.completedSteps.length > 0 && (
            <span>
              Done: <span className="text-slate-600">{session.completedSteps.join(", ")}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
