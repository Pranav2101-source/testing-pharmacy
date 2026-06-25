import { useState, useEffect, useCallback } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Layers, BookOpen, Bell, Search, Loader2, FileX, AlertCircle,
  Plus, X, Check, AlertTriangle, Clock, TrendingDown, ArrowUp, ArrowDown,
  ShieldAlert, Skull, MinusCircle, PlusCircle, Info, Printer, ShoppingCart, MapPin,
} from "lucide-react";
import { BarcodeLabelModal } from "@/components/BarcodeLabelModal";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ─── Types ─────────────────────────────────────────────────────────────────────

type BatchStatus = "ACTIVE" | "QUARANTINE" | "EXPIRED" | "DAMAGED";

type InventoryItem = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  quantity:         number;
  reservedQuantity: number;
  purchaseRate:     number;
  mrp:              number;
  location:         string | null;
  shelfId:          string | null;
  minimumStock:     number;
  status:           BatchStatus;
  medicine: {
    id:          string;
    name:        string;
    genericName: string | null;
    form:        string | null;
    strength:    string | null;
    hsnCode:     string | null;
    gstRate:     number;
    isActive:    boolean;
    brand:       { id: string; name: string } | null;
  };
  shelf: { id: string; code: string; rack: { id: string; code: string; name: string } } | null;
};

type LedgerEntry = {
  id:             string;
  type:           string;
  direction:      "IN" | "OUT";
  quantity:       number;
  quantityBefore: number;
  quantityAfter:  number;
  referenceType:  string | null;
  notes:          string | null;
  createdAt:      string;
  inventory: { batchNumber: string; medicine: { name: string; genericName: string | null } };
  user:       { id: string; name: string };
};

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_STATUS_CFG: Record<BatchStatus, { label: string; cls: string; icon: React.ElementType }> = {
  ACTIVE:     { label: "Active",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Check        },
  QUARANTINE: { label: "Quarantine", cls: "bg-amber-50   text-amber-700   border-amber-200",  icon: ShieldAlert  },
  EXPIRED:    { label: "Expired",    cls: "bg-red-50     text-red-600     border-red-200",    icon: Clock        },
  DAMAGED:    { label: "Damaged",    cls: "bg-gray-100   text-gray-600    border-gray-200",   icon: Skull        },
};

const REFERENCE_TYPE_LABEL: Record<string, string> = {
  GRN:            "GRN",
  INVOICE:        "Invoice",
  INVOICE_CANCEL: "Invoice Cancel",
  SALES_RETURN:   "Sales Return",
  SUPPLIER_RETURN:"Supplier Return",
  BATCH_RECALL:   "Batch Recall",
  STATUS_CHANGE:  "Status Change",
  STOCK_AUDIT:    "Stock Audit",
  CORRECTION:     "Correction",
  DAMAGE:         "Damage",
  EXPIRY_WRITEOFF:"Expiry Write-off",
  OPENING_BALANCE:"Opening Balance",
  TRANSFER:       "Transfer",
  THEFT:          "Theft",
  BREAKAGE:       "Breakage",
  STOCK_COUNT:    "Stock Count",
  OTHER:          "Other",
};

const MOVEMENT_TYPE_CFG: Record<string, string> = {
  SALE:           "text-red-600",
  RETURN:         "text-emerald-600",
  PURCHASE:       "text-blue-600",
  ADJUSTMENT:     "text-amber-600",
  OPENING:        "text-purple-600",
  DAMAGE:         "text-gray-600",
  EXPIRY_REMOVAL: "text-orange-600",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon: Icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
}) {
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap",
      active ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700",
    )}>
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={cn("text-[11px] font-bold rounded-full px-1.5 leading-[18px]",
          active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
        )}>{badge}</span>
      )}
    </button>
  );
}

function StatusBadge({ status }: { status: BatchStatus }) {
  const cfg = BATCH_STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap", cfg.cls)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ─── Adjustment Reason Codes ──────────────────────────────────────────────────

// Ordered by daily frequency of use in a pharmacy
const ADJUSTMENT_REASONS = [
  { value: "STOCK_COUNT",     label: "Physical Count",   hint: "After counting actual shelf stock"  },
  { value: "CORRECTION",      label: "Correction",       hint: "Fix a data entry mistake"           },
  { value: "DAMAGE",          label: "Damage",           hint: "Physically damaged — cannot sell"   },
  { value: "EXPIRY_WRITEOFF", label: "Expiry Write-off", hint: "Remove expired batch from stock"    },
  { value: "BREAKAGE",        label: "Breakage",         hint: "Broken vials, tablets, strips"      },
  { value: "THEFT",           label: "Theft / Loss",     hint: "Missing or stolen items"            },
  { value: "TRANSFER",        label: "Transfer",         hint: "Move stock to / from another store" },
  { value: "OPENING_BALANCE", label: "Opening Balance",  hint: "First-time entry for this batch"    },
  { value: "OTHER",           label: "Other",            hint: "Describe in notes below"            },
] as const;

// ─── Stock Adjustment Modal ───────────────────────────────────────────────────

function AdjustStockModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [mode,   setMode]   = useState<"add" | "remove">("add");
  const [qty,    setQty]    = useState(1);
  const [type,   setType]   = useState<string>("STOCK_COUNT");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (qty <= 0) { setError("Quantity must be a positive number"); return; }
    if (mode === "remove" && qty > item.quantity) {
      setError(`Cannot remove ${qty} — only ${item.quantity} in stock`); return;
    }
    if (!reason.trim()) { setError("Notes are required"); return; }
    setSaving(true); setError(null);
    try {
      const delta = mode === "add" ? qty : -qty;
      await api.patch(`/inventory/${item.id}/adjust`, { delta, reason, type });
      onToast(`Stock updated — ${item.medicine.name} (Batch ${item.batchNumber})`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline inside the modal so the user can correct and retry
      setError(err?.response?.data?.error ?? "Failed to adjust stock");
    } finally { setSaving(false); }
  }

  const newQty = mode === "add" ? item.quantity + qty : item.quantity - qty;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Adjust Stock</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber} · Current: <span className="font-bold text-slate-600">{item.quantity}</span></p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Add / Remove toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {(["add", "remove"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all",
                  mode === m
                    ? m === "add" ? "bg-emerald-600 text-white" : "bg-red-500 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                )}>
                {m === "add" ? <PlusCircle className="w-4 h-4" /> : <MinusCircle className="w-4 h-4" />}
                {m === "add" ? "Add Stock" : "Remove Stock"}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Quantity</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">−</button>
              <input type="number" value={qty} min={1} onChange={(e) => setQty(Math.max(1, +e.target.value))}
                className="w-20 text-center border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
              <button type="button" onClick={() => setQty((q) => q + 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">+</button>
              <span className="text-[12px] text-slate-400">
                → New qty: <span className={cn("font-bold", newQty < 0 ? "text-red-600" : "text-slate-700")}>{newQty}</span>
              </span>
            </div>
          </div>

          {/* Reason Code */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Reason Code</label>
            <div className="grid grid-cols-3 gap-2">
              {ADJUSTMENT_REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => setType(r.value)}
                  className={cn("text-left border rounded-lg px-2.5 py-2 transition-all",
                    type === r.value ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"
                  )}>
                  <p className="text-[12px] font-semibold text-slate-700">{r.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{r.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Describe the adjustment…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || newQty < 0}
              className={cn("px-5 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2",
                mode === "add" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-500 hover:bg-red-600"
              )}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Confirm Adjustment
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Batch Status Modal ────────────────────────────────────────────────────────

function BatchStatusModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [status, setStatus] = useState<BatchStatus>(item.status);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("Reason is required"); return; }
    setSaving(true); setError(null);
    try {
      await api.patch(`/inventory/${item.id}/status`, { status, reason });
      onToast(`Batch status updated to ${BATCH_STATUS_CFG[status].label}`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline so user can see it and retry without losing their input
      setError(err?.response?.data?.error ?? "Failed to update status");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Update Batch Status</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BATCH_STATUS_CFG) as BatchStatus[]).map((s) => {
              const cfg = BATCH_STATUS_CFG[s]; const Icon = cfg.icon;
              return (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={cn("flex items-center gap-2 border rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all",
                    status === s ? cn(cfg.cls, "ring-2 ring-offset-1 ring-current") : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}>
                  <Icon className="w-3.5 h-3.5" />{cfg.label}
                </button>
              );
            })}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Reason *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Why is this batch being changed?"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Update
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Assign Location Modal ─────────────────────────────────────────────────────

type ShelfOption = { id: string; code: string; level: number; rack: { id: string; code: string; name: string } };

function AssignLocationModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const initMode = item.shelf ? "shelf" : item.location ? "text" : "none";
  const [mode,     setMode]     = useState<"shelf" | "text" | "none">(initMode);
  const [shelfId,  setShelfId]  = useState(item.shelfId ?? "");
  const [freeText, setFreeText] = useState(item.location ?? "");
  const [shelves,  setShelves]  = useState<ShelfOption[]>([]);
  const [shelfErr, setShelfErr] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    api.get("/locations/shelves", { params: { limit: 500 } })
      .then((r) => setShelves(r.data.data.items ?? []))
      .catch(() => setShelfErr(true));
  }, []);

  const byRack = shelves.reduce<Record<string, { rackName: string; shelves: ShelfOption[] }>>((acc, s) => {
    const key = s.rack.code;
    if (!acc[key]) acc[key] = { rackName: `${s.rack.code} — ${s.rack.name}`, shelves: [] };
    acc[key].shelves.push(s);
    return acc;
  }, {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "shelf" && !shelfId) { setError("Please select a shelf"); return; }
    if (mode === "text" && !freeText.trim()) { setError("Enter a location label"); return; }
    setSaving(true); setError(null);
    try {
      const payload =
        mode === "shelf" ? { shelfId } :
        mode === "text"  ? { location: freeText.trim() } :
                           { shelfId: null, location: null };
      await api.patch(`/inventory/${item.id}/location`, payload);
      onToast(
        mode === "none" ? `Location cleared — ${item.medicine.name}` : `Location assigned — ${item.medicine.name}`,
        "success",
      );
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to update location");
    } finally { setSaving(false); }
  }

  const currentLabel =
    item.shelf    ? `${item.shelf.rack.code}/${item.shelf.code}` :
    item.location ? item.location : "None";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Assign Location</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">
              {item.medicine.name} · Batch {item.batchNumber} · Current: <span className="font-semibold text-slate-600">{currentLabel}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {([
              { key: "shelf" as const, label: "Shelf (Rack)" },
              { key: "text"  as const, label: "Free Text"    },
              { key: "none"  as const, label: "Clear"        },
            ]).map(({ key, label }) => (
              <button key={key} type="button" onClick={() => { setMode(key); setError(null); }}
                className={cn(
                  "flex-1 py-2.5 text-[12px] font-semibold transition-all",
                  mode === key
                    ? key === "none" ? "bg-red-500 text-white" : "bg-blue-600 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50",
                )}>
                {label}
              </button>
            ))}
          </div>

          {/* Shelf picker */}
          {mode === "shelf" && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Shelf</label>
              {shelfErr ? (
                <p className="text-[13px] text-red-500">Failed to load shelves. Check your connection and try again.</p>
              ) : shelves.length === 0 ? (
                <div className="flex items-center gap-2 text-[13px] text-slate-400 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading shelves…
                </div>
              ) : (
                <select value={shelfId} onChange={(e) => setShelfId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white">
                  <option value="">— Select a shelf —</option>
                  {Object.entries(byRack).map(([rackCode, group]) => (
                    <optgroup key={rackCode} label={group.rackName}>
                      {group.shelves.map((s) => (
                        <option key={s.id} value={s.id}>{rackCode}/{s.code} (Level {s.level})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Free-text */}
          {mode === "text" && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Location Label</label>
              <input type="text" value={freeText} onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. Aisle 3, Cold Room, Counter B"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          )}

          {/* Clear confirmation */}
          {mode === "none" && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-red-600">This will remove the shelf / location tag from this batch.</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className={cn(
                "px-5 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2",
                mode === "none" ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700",
              )}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {mode === "none" ? "Clear Location" : "Save Location"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Tab: Batches ──────────────────────────────────────────────────────────────

function BatchesTab() {
  const toast = useToast();
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState("");
  const [status,     setStatus]     = useState<BatchStatus | "">("");
  const [inStock,    setInStock]    = useState(false);
  const [lowStock,   setLowStock]   = useState(false);
  const [nearExpiry, setNearExpiry] = useState(false);
  const [statusModal,      setStatusModal]      = useState<InventoryItem | null>(null);
  const [adjustModal,      setAdjustModal]      = useState<InventoryItem | null>(null);
  const [locationModal,    setLocationModal]    = useState<InventoryItem | null>(null);
  const [barcodePrintItem, setBarcodePrintItem] = useState<InventoryItem | null>(null);

  // Debounce search input before it becomes part of the query key
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search]);

  const queryParams = { page, search: debouncedSearch, status, inStock, lowStock, nearExpiry };
  const { data, isFetching: loading, error: queryError, refetch: load } = useQuery({
    queryKey:        queryKeys.inventory.list(queryParams),
    queryFn:         () => {
      const p: Record<string, string | number | boolean> = { page, limit: 20 };
      if (debouncedSearch) p.search     = debouncedSearch;
      if (status)          p.status     = status;
      if (inStock)         p.inStock    = true;
      if (lowStock)        p.lowStock   = true;
      if (nearExpiry)      p.nearExpiry = true;
      return api.get("/inventory", { params: p }).then((r) => r.data.data as { items: InventoryItem[]; total: number });
    },
    staleTime:       30_000,
    // Keep previous page's rows visible while the next page or a filtered result loads —
    // eliminates the spinner flash on every page change and filter toggle.
    placeholderData: keepPreviousData,
  });

  const items      = data?.items      ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;
  const error      = queryError ? "Failed to load inventory" : null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] shadow-sm flex-1 max-w-[280px]">
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search medicine, batch…"
            className="px-3 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-full h-full text-[13px]" />
          <span className="px-2.5 text-slate-400"><Search className="w-3.5 h-3.5" /></span>
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as BatchStatus | ""); setPage(1); }}
          className="border border-slate-200 bg-white rounded-md h-[30px] px-2.5 text-[12px] text-slate-600 focus:outline-none shadow-sm">
          <option value="">All statuses</option>
          {(Object.keys(BATCH_STATUS_CFG) as BatchStatus[]).map((s) => (
            <option key={s} value={s}>{BATCH_STATUS_CFG[s].label}</option>
          ))}
        </select>
        {([
          { label: "In Stock",    val: inStock,    set: setInStock    },
          { label: "Low Stock",   val: lowStock,   set: setLowStock   },
          { label: "Near Expiry", val: nearExpiry, set: setNearExpiry },
        ] as const).map(({ label, val, set }) => (
          <button key={label} onClick={() => { (set as any)((v: boolean) => !v); setPage(1); }}
            className={cn("h-[30px] px-3 rounded-md text-[12px] font-semibold border transition-all shadow-sm",
              val ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            )}>
            {label}
          </button>
        ))}
        <span className="text-[12px] text-slate-400 ml-auto flex items-center gap-1.5">
          {/* Subtle spinner shown only during background re-fetches (data already visible) */}
          {loading && items.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          {total} batches
        </span>
      </div>

      {/* Table — dim rows slightly during background re-fetch so the user knows data is refreshing */}
      <div className={cn("flex-1 overflow-auto min-h-0 transition-opacity duration-150", loading && items.length > 0 && "opacity-60")}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Medicine","Batch No.","Expiry","Stock"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Reserved
                  <span title="Units held for pending sales / in-progress billing. Automatically released when the bill is finalised or cancelled." className="cursor-help">
                    <Info className="w-3 h-3 text-slate-400" />
                  </span>
                </span>
              </th>
              {["MRP","Buy Rate","Location","Status","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={10} className="py-24 text-center"><Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : error ? (
              <tr><td colSpan={10} className="py-16 text-center"><AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" /><p className="text-red-500 text-[13px]">{error}</p><button onClick={() => void load()} className="mt-2 text-blue-600 text-[12px] hover:underline">Retry</button></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No batches found</p></td></tr>
            ) : items.map((item) => {
              const days = daysUntil(item.expiryDate);
              const isNE = days <= 90 && days > 0;
              const isEx = days <= 0;
              return (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-[13px] font-semibold text-slate-800 max-w-[160px] truncate">{item.medicine.name}</p>
                    {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                    {item.medicine.brand && <p className="text-[10px] text-blue-400">{item.medicine.brand.name}</p>}
                  </td>
                  <td className="px-4 py-3 text-[12px] font-mono text-slate-700">{item.batchNumber}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[12px] font-semibold", isEx ? "text-red-600" : isNE ? "text-amber-600" : "text-slate-600")}>
                      {fmt(item.expiryDate)}
                    </span>
                    {isNE && <p className="text-[10px] text-amber-500">{days}d left</p>}
                    {isEx && <p className="text-[10px] text-red-500">Expired</p>}
                  </td>
                  <td className="px-4 py-3">
                    {item.quantity === 0
                      ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Out of stock</span>
                      : item.quantity <= item.minimumStock
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Low: {item.quantity}</span>
                        : <span className="text-[13px] font-semibold text-slate-800 tabular-nums">{item.quantity}</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.reservedQuantity || "—"}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 tabular-nums">₹{item.mrp.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">₹{item.purchaseRate.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {item.shelf
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{item.shelf.rack.code}/{item.shelf.code}</span>
                      : item.location
                        ? <span className="text-[12px] text-slate-500">{item.location}</span>
                        : <span className="text-slate-300 text-[12px]">—</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setAdjustModal(item)}
                        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 rounded-md px-2 py-1 transition-colors">
                        Adjust
                      </button>
                      <button onClick={() => setStatusModal(item)}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-blue-50/50 hover:bg-blue-50 rounded-md px-2 py-1 transition-colors">
                        Status
                      </button>
                      <button onClick={() => setLocationModal(item)} title="Assign location"
                        className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-teal-600 transition-colors">
                        <MapPin className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setBarcodePrintItem(item)} title="Print barcode label"
                        className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span></span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {statusModal && (
          <BatchStatusModal item={statusModal} onClose={() => setStatusModal(null)}
            onDone={() => { setStatusModal(null); void load(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
        {adjustModal && (
          <AdjustStockModal item={adjustModal} onClose={() => setAdjustModal(null)}
            onDone={() => { setAdjustModal(null); void load(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
        {locationModal && (
          <AssignLocationModal item={locationModal} onClose={() => setLocationModal(null)}
            onDone={() => { setLocationModal(null); void load(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
      </AnimatePresence>

      {barcodePrintItem && (
        <BarcodeLabelModal
          item={{
            medicineName: barcodePrintItem.medicine.name,
            genericName:  barcodePrintItem.medicine.genericName,
            batchNumber:  barcodePrintItem.batchNumber,
            expiryDate:   barcodePrintItem.expiryDate,
            mrp:          barcodePrintItem.mrp,
          }}
          onClose={() => setBarcodePrintItem(null)}
        />
      )}
    </div>
  );
}

// ─── Tab: Stock Ledger ─────────────────────────────────────────────────────────

function LedgerTab() {
  const [entries,    setEntries]    = useState<LedgerEntry[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [direction,  setDirection]  = useState<"" | "IN" | "OUT">("");
  const [type,       setType]       = useState("");

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (direction) params.direction = direction;
      if (type)      params.type      = type;
      const { data } = await api.get("/inventory/ledger", { params });
      setEntries(data.data.movements);
      setTotal(data.data.total);
      setTotalPages(Math.ceil(data.data.total / 50));
    } catch {
      setLoadError("Failed to load ledger. Check your connection and try again.");
    }
    finally { setLoading(false); }
  }, [page, direction, type]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="border border-slate-200 bg-white rounded-md h-[30px] px-2.5 text-[12px] text-slate-600 focus:outline-none shadow-sm">
          <option value="">All types</option>
          {["SALE","RETURN","PURCHASE","ADJUSTMENT","OPENING","DAMAGE","EXPIRY_REMOVAL"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(["", "IN", "OUT"] as const).map((d) => (
          <button key={d} onClick={() => { setDirection(d); setPage(1); }}
            className={cn("h-[30px] px-3 rounded-md text-[12px] font-semibold border transition-all shadow-sm",
              direction === d ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            )}>
            {d === "" ? "All" : d === "IN" ? "↑ IN" : "↓ OUT"}
          </button>
        ))}
        <span className="text-[12px] text-slate-400 ml-auto">{total} movements</span>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Date/Time","Medicine","Batch","Type","Dir","Qty","Before→After","Reference","User"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-24 text-center"><Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : loadError ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
                <p className="text-[13px] text-red-500 font-medium mb-2">{loadError}</p>
                <button onClick={load} className="text-[12px] text-blue-600 hover:underline">Retry</button>
              </td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={9} className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No movements yet</p></td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}<br />
                  <span className="text-slate-400">{new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[13px] font-semibold text-slate-800 max-w-[130px] truncate">{e.inventory?.medicine?.name ?? "—"}</p>
                  {e.inventory?.medicine?.genericName && <p className="text-[10px] text-slate-400 truncate">{e.inventory.medicine.genericName}</p>}
                </td>
                <td className="px-4 py-3 text-[11px] font-mono text-slate-600">{e.inventory?.batchNumber ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={cn("text-[12px] font-bold", MOVEMENT_TYPE_CFG[e.type] ?? "text-slate-600")}>{e.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1 text-[12px] font-bold", e.direction === "IN" ? "text-emerald-600" : "text-red-600")}>
                    {e.direction === "IN" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    {e.direction}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] font-bold tabular-nums text-slate-800">{e.quantity}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{e.quantityBefore} → {e.quantityAfter}</td>
                <td className="px-4 py-3" title={e.notes ?? undefined}>
                  <span className="text-[11px] text-slate-500 font-medium">{e.referenceType ? (REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType) : "—"}</span>
                  {e.notes && (
                    <p className="text-[10px] text-slate-400 max-w-[120px] truncate mt-0.5">{e.notes}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{e.user?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && total > 50 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*50+1,total)}–{Math.min(page*50,total)}</span> of <span className="font-semibold text-slate-700">{total}</span></span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alert tier configs ────────────────────────────────────────────────────────

type ExpiryTier  = "EXPIRED" | "CRITICAL" | "WARNING" | "NOTICE";
type StockTier   = "OUT_OF_STOCK" | "REORDER" | "LOW";

type ExpiryAlert = InventoryItem & { tier: ExpiryTier; daysToExpiry: number };
type StockAlert  = InventoryItem & { tier: StockTier };

const EXPIRY_TIER_CFG: Record<ExpiryTier, { label: string; rowCls: string; badgeCls: string }> = {
  EXPIRED:  { label: "Expired",   rowCls: "bg-red-50/40",    badgeCls: "bg-red-100     text-red-700   border-red-300"   },
  CRITICAL: { label: "≤ 30 days", rowCls: "bg-orange-50/30", badgeCls: "bg-orange-50   text-orange-700 border-orange-200" },
  WARNING:  { label: "31–60 days",rowCls: "bg-amber-50/20",  badgeCls: "bg-amber-50    text-amber-700  border-amber-200"  },
  NOTICE:   { label: "61–90 days",rowCls: "",                badgeCls: "bg-yellow-50   text-yellow-700 border-yellow-200" },
};

const STOCK_TIER_CFG: Record<StockTier, { label: string; badgeCls: string }> = {
  OUT_OF_STOCK: { label: "Out of Stock", badgeCls: "bg-red-100   text-red-700   border-red-300"   },
  REORDER:      { label: "Reorder Now",  badgeCls: "bg-orange-50 text-orange-700 border-orange-200" },
  LOW:          { label: "Low Stock",    badgeCls: "bg-amber-50  text-amber-700  border-amber-200"  },
};

// ─── Tab: Alerts ───────────────────────────────────────────────────────────────

const ALERTS_PAGE_SIZE = 25;

function AlertsTab() {
  const navigate = useNavigate();
  const [expiryItems, setExpiryItems] = useState<ExpiryAlert[]>([]);
  const [lowItems,    setLowItems]    = useState<StockAlert[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryTier | "">("");
  const [expiryPage,  setExpiryPage]  = useState(1);
  const [stockPage,   setStockPage]   = useState(1);

  const loadAlerts = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [ex, lw] = await Promise.all([
        api.get("/inventory/alerts/expiry"),
        api.get("/inventory/alerts/low-stock"),
      ]);
      setExpiryItems(ex.data.data ?? []);
      setLowItems(lw.data.data ?? []);
    } catch {
      setLoadError("Failed to load alerts. Check your connection and try again.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertCircle className="w-8 h-8 text-red-300" />
      <p className="text-[13px] text-red-500 font-medium">{loadError}</p>
      <button onClick={loadAlerts} className="text-[12px] text-blue-600 hover:underline">Retry</button>
    </div>
  );

  const filteredExpiry = expiryFilter ? expiryItems.filter((i) => i.tier === expiryFilter) : expiryItems;

  const expiryCounts = {
    EXPIRED:  expiryItems.filter((i) => i.tier === "EXPIRED").length,
    CRITICAL: expiryItems.filter((i) => i.tier === "CRITICAL").length,
    WARNING:  expiryItems.filter((i) => i.tier === "WARNING").length,
    NOTICE:   expiryItems.filter((i) => i.tier === "NOTICE").length,
  };

  const expiryTotalPages = Math.max(1, Math.ceil(filteredExpiry.length / ALERTS_PAGE_SIZE));
  const pagedExpiry = filteredExpiry.slice((expiryPage - 1) * ALERTS_PAGE_SIZE, expiryPage * ALERTS_PAGE_SIZE);

  const stockTotalPages = Math.max(1, Math.ceil(lowItems.length / ALERTS_PAGE_SIZE));
  const pagedStock = lowItems.slice((stockPage - 1) * ALERTS_PAGE_SIZE, stockPage * ALERTS_PAGE_SIZE);

  const thCls = "px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide";

  return (
    <div className="flex-1 overflow-auto p-5 space-y-6">

      {/* Expiry section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><Clock className="w-3.5 h-3.5 text-amber-600" /></div>
            <h3 className="text-[14px] font-bold text-slate-800">Expiry Alerts</h3>
            <span className="text-[12px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{expiryItems.length}</span>
          </div>
          {/* Tier filter pills */}
          <div className="flex items-center gap-1.5">
            {(["", "EXPIRED", "CRITICAL", "WARNING", "NOTICE"] as const).map((tier) => {
              const count = tier === "" ? expiryItems.length : expiryCounts[tier];
              return (
                <button key={tier} onClick={() => { setExpiryFilter(tier); setExpiryPage(1); }}
                  className={cn("text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-all",
                    expiryFilter === tier ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                  )}>
                  {tier === "" ? `All (${count})` : `${EXPIRY_TIER_CFG[tier as ExpiryTier].label} (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {filteredExpiry.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-slate-500 font-medium">No items in this category</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50"><tr className="border-b border-slate-200">
                {["Severity","Medicine","Batch","Expiry Date","Days Left","Stock","Location"].map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedExpiry.map((item) => {
                  const cfg = EXPIRY_TIER_CFG[item.tier];
                  return (
                    <tr key={item.id} className={cn("border-b border-slate-100 last:border-0 transition-colors hover:brightness-95", cfg.rowCls)}>
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", cfg.badgeCls)}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400">{item.medicine.genericName}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-mono text-slate-600">{item.batchNumber}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-slate-600">{fmt(item.expiryDate)}</td>
                      <td className="px-4 py-3 text-[13px] font-bold tabular-nums text-slate-700">
                        {item.daysToExpiry <= 0 ? <span className="text-red-600">Expired</span> : `${item.daysToExpiry}d`}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-slate-700 tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-400">{item.location ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredExpiry.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
                <span className="text-[12px] text-slate-500">
                  Showing <span className="font-semibold text-slate-700">{(expiryPage - 1) * ALERTS_PAGE_SIZE + 1}–{Math.min(expiryPage * ALERTS_PAGE_SIZE, filteredExpiry.length)}</span> of <span className="font-semibold text-slate-700">{filteredExpiry.length}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setExpiryPage((p) => Math.max(1, p - 1))} disabled={expiryPage === 1}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
                  <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{expiryPage} / {expiryTotalPages}</span>
                  <button onClick={() => setExpiryPage((p) => Math.min(expiryTotalPages, p + 1))} disabled={expiryPage === expiryTotalPages}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Low stock section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><TrendingDown className="w-3.5 h-3.5 text-red-500" /></div>
          <h3 className="text-[14px] font-bold text-slate-800">Stock Alerts</h3>
          <span className="text-[12px] font-semibold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">{lowItems.length}</span>
        </div>
        {lowItems.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-slate-500 font-medium">All stock levels are healthy</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50"><tr className="border-b border-slate-200">
                {["Status","Medicine","Batch","Stock","Reorder Level","Min Stock","MRP",""].map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedStock.map((item) => {
                  const cfg = STOCK_TIER_CFG[item.tier];
                  return (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-red-50/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", cfg.badgeCls)}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400">{item.medicine.genericName}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-mono text-slate-600">{item.batchNumber}</td>
                      <td className="px-4 py-3 text-[14px] font-bold text-red-600 tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{(item as any).reorderLevel ?? "—"}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.minimumStock}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 tabular-nums">₹{item.mrp.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(
                            `/dashboard/purchase?create-po=1&medicineId=${encodeURIComponent(item.medicine.id)}&medicine=${encodeURIComponent(item.medicine.name)}&gstRate=${item.medicine.gstRate}`
                          )}
                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-2.5 py-1 transition-colors whitespace-nowrap"
                        >
                          <ShoppingCart className="w-3 h-3" />Create PO
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lowItems.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
                <span className="text-[12px] text-slate-500">
                  Showing <span className="font-semibold text-slate-700">{(stockPage - 1) * ALERTS_PAGE_SIZE + 1}–{Math.min(stockPage * ALERTS_PAGE_SIZE, lowItems.length)}</span> of <span className="font-semibold text-slate-700">{lowItems.length}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setStockPage((p) => Math.max(1, p - 1))} disabled={stockPage === 1}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
                  <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{stockPage} / {stockTotalPages}</span>
                  <button onClick={() => setStockPage((p) => Math.min(stockTotalPages, p + 1))} disabled={stockPage === stockTotalPages}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "batches" | "ledger" | "alerts";

export default function InventoryPage() {
  const [tab,         setTab]         = useState<Tab>("batches");
  const [alertCounts, setAlertCounts] = useState({ expiry: 0, lowStock: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [ex, lw] = await Promise.all([api.get("/inventory/alerts/expiry"), api.get("/inventory/alerts/low-stock")]);
        setAlertCounts({ expiry: ex.data.data.length, lowStock: lw.data.data.length });
      } catch {/* */}
    })();
  }, []);

  const totalAlerts = alertCounts.expiry + alertCounts.lowStock;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Inventory</h1>
          {totalAlerts > 0 && (
            <span className="flex items-center gap-1 text-[12px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2.5 py-0.5">
              <AlertTriangle className="w-3 h-3" />{totalAlerts} alerts
            </span>
          )}
        </div>
        <Plus className="w-4 h-4 text-slate-400" />
      </div>

      <div className="flex items-center gap-0 px-5 border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto">
        <TabBtn active={tab==="batches"} onClick={() => setTab("batches")} icon={Layers}   label="Batches" />
        <TabBtn active={tab==="ledger"}  onClick={() => setTab("ledger")}  icon={BookOpen} label="Stock Ledger" />
        <TabBtn active={tab==="alerts"}  onClick={() => setTab("alerts")}  icon={Bell}     label="Alerts" badge={totalAlerts} />
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {tab === "batches" && <BatchesTab />}
        {tab === "ledger"  && <LedgerTab />}
        {tab === "alerts"  && <AlertsTab />}
      </div>
    </div>
  );
}
