import { useState, useEffect, useCallback } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StockAuditContent } from "./StockAuditPage";
import { AnimatePresence, motion } from "framer-motion";
import {
  Layers, BookOpen, Bell, Search, Loader2, FileX, AlertCircle,
  Plus, X, Check, AlertTriangle, Clock, TrendingDown, ArrowUp, ArrowDown,
  ShieldAlert, Skull, MinusCircle, PlusCircle, Info, Printer, ShoppingCart, MapPin,
  ClipboardList, Package2, Sparkles,
} from "lucide-react";
import { BarcodeLabelModal } from "@/components/BarcodeLabelModal";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";

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
  reorderLevel:     number;
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

const TAB_COLORS = {
  blue:   { border: "border-blue-600",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-700",     icon: "text-blue-600"   },
  purple: { border: "border-purple-600", text: "text-purple-700", badge: "bg-purple-100 text-purple-700", icon: "text-purple-600" },
  red:    { border: "border-red-600",    text: "text-red-700",    badge: "bg-red-100 text-red-700",       icon: "text-red-600"    },
  orange: { border: "border-orange-500", text: "text-orange-700", badge: "bg-orange-100 text-orange-700", icon: "text-orange-500" },
} as const;

function TabBtn({ active, onClick, icon: Icon, label, badge, color = "blue" }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
  color?: keyof typeof TAB_COLORS;
}) {
  const c = TAB_COLORS[color];
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap",
      active
        ? cn(c.border, c.text)
        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200",
    )}>
      <Icon className={cn("w-3.5 h-3.5", active ? c.icon : "text-slate-400")} />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={cn("text-[11px] font-bold rounded-full px-1.5 leading-[18px]",
          active ? c.badge : "bg-slate-100 text-slate-500"
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
      await api.patch(`/inventory/${item.id}`, { adjust: { delta, reason, type } });
      onToast(`Stock updated — ${item.medicine.name} (Batch ${item.batchNumber})`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline inside the modal so the user can correct and retry
      setError(getErrorMessage(err, "Failed to adjust stock"));
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
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Adjust Stock</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber} · Current: <span className="font-bold text-slate-600">{item.quantity}</span></p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
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
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">−</button>
                <input type="number" value={qty} min={1} onChange={(e) => setQty(Math.max(1, +e.target.value))}
                  className="w-20 text-center border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
                <button type="button" onClick={() => setQty((q) => q + 1)}
                  className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">+</button>
              </div>
              <span className="text-[12px] text-slate-400">
                → New qty: <span className={cn("font-bold", newQty < 0 ? "text-red-600" : "text-slate-700")}>{newQty}</span>
              </span>
            </div>
          </div>

          {/* Reason Code */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Reason Code</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
      await api.patch(`/inventory/${item.id}`, { status, statusReason: reason });
      onToast(`Batch status updated to ${BATCH_STATUS_CFG[status].label}`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline so user can see it and retry without losing their input
      setError(getErrorMessage(err, "Failed to update status"));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Update Batch Status</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
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
    api.get("/locations/shelves", { params: { dropdown: true } })
      .then((r) => setShelves(r.data.data ?? []))
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
      await api.patch(`/inventory/${item.id}`, payload);
      onToast(
        mode === "none" ? `Location cleared — ${item.medicine.name}` : `Location assigned — ${item.medicine.name}`,
        "success",
      );
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to update location"));
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
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
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

        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
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

// ─── Calibrate Modal ───────────────────────────────────────────────────────────

const WASTE_RISK_CFG: Record<WasteRiskTier, { label: string; cls: string }> = {
  HIGH:    { label: "High Risk",  cls: "bg-red-50    text-red-700   border-red-300"    },
  MEDIUM:  { label: "Med Risk",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  LOW:     { label: "Low Risk",   cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  SAFE:    { label: "All Clear",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  NO_DATA: { label: "No Data",   cls: "bg-slate-100 text-slate-500  border-slate-200"  },
};

function CalibrateModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  type Phase = "loading" | "preview" | "applying" | "done";
  const [phase,   setPhase]   = useState<Phase>("loading");
  const [preview, setPreview] = useState<CalibrateResult | null>(null);
  const [applied, setApplied] = useState<CalibrateResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Dry run on mount
  useEffect(() => {
    api.post("/inventory/calibrate-stock", { dryRun: true })
      .then((r) => { setPreview(r.data.data as CalibrateResult); setPhase("preview"); })
      .catch((e) => { setError(getErrorMessage(e, "Failed to analyze inventory")); setPhase("preview"); });
  }, []);

  async function applyChanges() {
    setPhase("applying");
    try {
      const r = await api.post("/inventory/calibrate-stock", { dryRun: false });
      setApplied(r.data.data as CalibrateResult);
      setPhase("done");
      onApplied();
    } catch (e: any) {
      setError(getErrorMessage(e, "Failed to apply changes"));
      setPhase("preview");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900">Smart Stock Calibration</h2>
              <p className="text-[12px] text-slate-400 truncate">90-day sales analysis → optimal minimum stock levels</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors flex-shrink-0">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-[13px] text-slate-500">Analyzing 90 days of sales data…</p>
            </div>
          )}

          {(phase === "preview" || phase === "applying") && (
            <>
              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-600">{error}</div>
              )}
              {preview && (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
                    {[
                      { label: "Will Update",     value: preview.updated, cls: "text-blue-600 bg-blue-50 border-blue-100" },
                      { label: "Already Optimal", value: Math.max(0, preview.analyzed - preview.updated - preview.skipped), cls: "text-emerald-600 bg-emerald-50 border-emerald-100" },
                      { label: "No Sales Data",   value: preview.skipped, cls: "text-slate-500 bg-slate-50 border-slate-100" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className={cn("rounded-xl border p-2.5 sm:p-3 text-center", cls)}>
                        <p className="text-[18px] sm:text-[22px] font-bold tabular-nums">{value}</p>
                        <p className="text-[10px] sm:text-[11px] font-medium mt-0.5 opacity-75">{label}</p>
                      </div>
                    ))}
                  </div>

                  {preview.changes.length === 0 ? (
                    <div className="text-center py-10 bg-emerald-50 rounded-xl border border-emerald-100">
                      <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-[14px] font-semibold text-emerald-700">All minimum stock levels are already optimal</p>
                      <p className="text-[12px] text-emerald-500 mt-1">No changes needed based on your sales patterns</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[12px] text-slate-500 mb-2">
                        Formula: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">avg_daily × 7 days × 1.5 safety</span> · floor: 5 units
                      </p>
                      <div className="border border-slate-200 rounded-xl overflow-x-auto">
                        <table className="w-full min-w-[420px]">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {["Medicine", "Old Min", "New Min", "Avg / Day"].map((h) => (
                                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.changes.map((c) => (
                              <tr key={c.medicineId} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/30">
                                <td className="px-4 py-2.5 text-[13px] font-medium text-slate-800 whitespace-nowrap">{c.medicineName}</td>
                                <td className="px-4 py-2.5 text-[13px] text-slate-400 tabular-nums">{c.oldMin}</td>
                                <td className="px-4 py-2.5">
                                  <span className={cn("text-[13px] font-bold tabular-nums whitespace-nowrap", c.newMin > c.oldMin ? "text-blue-600" : "text-emerald-600")}>
                                    {c.newMin > c.oldMin ? "↑" : "↓"} {c.newMin}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-[12px] text-slate-500 tabular-nums whitespace-nowrap">{c.avgDailySales}/day</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {phase === "done" && applied && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <p className="text-[16px] font-bold text-slate-800">Calibration Complete</p>
                <p className="text-[13px] text-slate-500 mt-1">
                  {applied.updated} medicine{applied.updated !== 1 ? "s" : ""} updated · {applied.skipped} skipped
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-100 transition-colors">
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase === "preview" && preview && preview.changes.length > 0 && !error && (
            <button
              onClick={applyChanges}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Apply {preview.updated} Change{preview.updated !== 1 ? "s" : ""}
            </button>
          )}
          {phase === "applying" && (
            <button disabled className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-400 text-white text-[13px] font-semibold opacity-70">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Tab: Batches ──────────────────────────────────────────────────────────────

type AlertCounts = { expiry: number; lowStock: number };

function BatchesTab({ onCountsLoaded }: { onCountsLoaded: (c: AlertCounts) => void }) {
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
  const [showCalibrate,    setShowCalibrate]    = useState(false);

  const isOwnerOrManager = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

  // Debounce search input before it becomes part of the query key
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search]);

  type ListResponse = { items: InventoryItem[]; total: number; alertCounts: AlertCounts };
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
      return api.get("/inventory", { params: p }).then((r) => r.data.data as ListResponse);
    },
    staleTime:       30_000,
    placeholderData: keepPreviousData,
  });

  // Propagate alert counts to the parent header badge whenever a fresh response arrives.
  useEffect(() => {
    if (data?.alertCounts) onCountsLoaded(data.alertCounts);
  }, [data?.alertCounts, onCountsLoaded]);

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
          {loading && items.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          {total} batches
        </span>
        {isOwnerOrManager && (
          <button
            onClick={() => setShowCalibrate(true)}
            title="Auto-calibrate minimum stock levels from sales data"
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[12px] font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors shadow-sm whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Calibrate Stock
          </button>
        )}
      </div>
      {showCalibrate && (
        <CalibrateModal
          onClose={() => setShowCalibrate(false)}
          onApplied={() => { void load(); }}
        />
      )}

      {/* Table (desktop) / Cards (phone) — dim slightly during background re-fetch */}
      <div className={cn("flex-1 overflow-auto min-h-0 transition-opacity duration-150", loading && items.length > 0 && "opacity-60")}>
        <table className="w-full border-collapse hidden md:table">
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

        {/* Phone cards */}
        <div className="md:hidden">
          {loading && items.length === 0 ? (
            <div className="py-24 text-center"><Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" /></div>
          ) : error ? (
            <div className="py-16 text-center px-4">
              <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
              <p className="text-red-500 text-[13px]">{error}</p>
              <button onClick={() => void load()} className="mt-2 text-blue-600 text-[12px] hover:underline">Retry</button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No batches found</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const days = daysUntil(item.expiryDate);
                const isNE = days <= 90 && days > 0;
                const isEx = days <= 0;
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                        {item.medicine.brand && <p className="text-[10px] text-blue-400">{item.medicine.brand.name}</p>}
                      </div>
                      <StatusBadge status={item.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-3">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-700">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Expiry</span>
                        <p className={cn("font-semibold", isEx ? "text-red-600" : isNE ? "text-amber-600" : "text-slate-600")}>
                          {fmt(item.expiryDate)}{isNE && ` · ${days}d left`}{isEx && " · Expired"}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Stock</span>
                        <p>
                          {item.quantity === 0
                            ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Out of stock</span>
                            : item.quantity <= item.minimumStock
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Low: {item.quantity}</span>
                              : <span className="font-semibold text-slate-800 tabular-nums">{item.quantity}</span>}
                        </p>
                      </div>
                      <div><span className="text-slate-400">Reserved</span><p className="text-slate-600 tabular-nums">{item.reservedQuantity || "—"}</p></div>
                      <div><span className="text-slate-400">MRP</span><p className="text-slate-700 tabular-nums">₹{item.mrp.toFixed(2)}</p></div>
                      <div><span className="text-slate-400">Buy Rate</span><p className="text-slate-500 tabular-nums">₹{item.purchaseRate.toFixed(2)}</p></div>
                    </div>

                    {(item.shelf || item.location) && (
                      <div className="mb-3">
                        {item.shelf
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{item.shelf.rack.code}/{item.shelf.code}</span>
                          : <span className="text-[12px] text-slate-500">{item.location}</span>}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setAdjustModal(item)}
                        className="text-[12px] font-semibold text-emerald-600 border border-emerald-200 bg-emerald-50/50 active:bg-emerald-100 rounded-md px-3 py-1.5">
                        Adjust
                      </button>
                      <button onClick={() => setStatusModal(item)}
                        className="text-[12px] font-semibold text-blue-600 border border-blue-200 bg-blue-50/50 active:bg-blue-100 rounded-md px-3 py-1.5">
                        Status
                      </button>
                      <button onClick={() => setLocationModal(item)} title="Assign location"
                        className="p-2 rounded-md border border-slate-200 text-slate-400 active:bg-slate-100">
                        <MapPin className="w-4 h-4" />
                      </button>
                      <button onClick={() => setBarcodePrintItem(item)} title="Print barcode label"
                        className="p-2 rounded-md border border-slate-200 text-slate-400 active:bg-slate-100">
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
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

  const showSkeleton = loading && entries.length === 0 && !loadError;

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
        <span className="text-[12px] text-slate-400 ml-auto flex items-center gap-1.5">
          {loading && entries.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          {total} movements
        </span>
      </div>

      <div className={cn("flex-1 overflow-auto min-h-0 transition-opacity duration-150", loading && entries.length > 0 && "opacity-60")}>
        <table className="w-full border-collapse hidden md:table">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Date/Time","Medicine","Batch","Type","Dir","Qty","Before→After","Reference","User"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-4 py-3"><div className="skeleton h-3 w-14 rounded mb-1" /><div className="skeleton h-2.5 w-10 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3.5 w-28 rounded mb-1" /><div className="skeleton h-2.5 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-10 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3.5 w-8 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                </tr>
              ))
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

        {/* Phone cards */}
        <div className="md:hidden">
          {showSkeleton ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="skeleton h-3.5 w-32 rounded" />
                    <div className="skeleton h-3.5 w-10 rounded" />
                  </div>
                  <div className="skeleton h-3 w-44 rounded mb-2" />
                  <div className="flex items-center justify-between">
                    <div className="skeleton h-2.5 w-24 rounded" />
                    <div className="skeleton h-2.5 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="py-24 text-center px-4">
              <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
              <p className="text-[13px] text-red-500 font-medium mb-2">{loadError}</p>
              <button onClick={load} className="text-[12px] text-blue-600 hover:underline">Retry</button>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No movements yet</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map((e) => (
                <div key={e.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{e.inventory?.medicine?.name ?? "—"}</p>
                      {e.inventory?.medicine?.genericName && <p className="text-[11px] text-slate-400 truncate">{e.inventory.medicine.genericName}</p>}
                    </div>
                    <span className={cn("inline-flex items-center gap-1 text-[12px] font-bold flex-shrink-0", e.direction === "IN" ? "text-emerald-600" : "text-red-600")}>
                      {e.direction === "IN" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {e.quantity}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] mb-1.5">
                    <span className={cn("font-bold", MOVEMENT_TYPE_CFG[e.type] ?? "text-slate-600")}>{e.type}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-500">{e.inventory?.batchNumber ?? "—"}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-400 tabular-nums">{e.quantityBefore} → {e.quantityAfter}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{e.referenceType ? (REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType) : "—"} · {e.user?.name ?? "—"}</span>
                    <span className="whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}{" "}
                      {new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                    </span>
                  </div>
                  {e.notes && <p className="text-[11px] text-slate-400 mt-1 truncate">{e.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!loading && total > 50 && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
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

// ─── AI insight types ──────────────────────────────────────────────────────────

type WasteRiskTier = "HIGH" | "MEDIUM" | "LOW" | "SAFE" | "NO_DATA";

type WasteRisk = {
  avgDailySales: number;
  willSellUnits: number;
  atRiskUnits:   number;
  potentialLoss: number;
  riskTier:      WasteRiskTier;
};

type ReorderInsight = {
  avgDailySales: number;
  suggestedQty:  number;
  coverDays:     number;
  leadTimeDays:  number;
  hasData:       boolean;
};

type CalibrateChange = {
  medicineId:    string;
  medicineName:  string;
  oldMin:        number;
  newMin:        number;
  avgDailySales: number;
};

type CalibrateResult = {
  updated:  number;
  skipped:  number;
  analyzed: number;
  changes:  CalibrateChange[];
};

// ─── Alert tier configs ────────────────────────────────────────────────────────

type ExpiryTier  = "EXPIRED" | "CRITICAL" | "WARNING" | "NOTICE";
type StockTier   = "OUT_OF_STOCK" | "REORDER" | "LOW";

type ExpiryAlert = InventoryItem & { tier: ExpiryTier; daysToExpiry: number; wasteRisk: WasteRisk };
type StockAlert  = InventoryItem & { tier: StockTier; reorder: ReorderInsight };

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

function AlertsTab({ onCountsLoaded }: { onCountsLoaded: (c: AlertCounts) => void }) {
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
      const res = await api.get("/inventory/alerts");
      const expiry   = res.data.data.expiry   ?? [];
      const lowStock = res.data.data.lowStock  ?? [];
      setExpiryItems(expiry);
      setLowItems(lowStock);
      onCountsLoaded({ expiry: expiry.length, lowStock: lowStock.length });
    } catch {
      setLoadError("Failed to load alerts. Check your connection and try again.");
    } finally { setLoading(false); }
  }, [onCountsLoaded]);

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
            <table className="w-full hidden md:table">
              <thead className="bg-slate-50"><tr className="border-b border-slate-200">
                {["Severity","Medicine","Batch","Expiry Date","Days Left","Stock","Waste Risk","Location"].map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedExpiry.map((item) => {
                  const cfg  = EXPIRY_TIER_CFG[item.tier];
                  const risk = item.wasteRisk;
                  const rCfg = WASTE_RISK_CFG[risk.riskTier];
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
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", rCfg.cls)}>{rCfg.label}</span>
                        {risk.riskTier !== "SAFE" && risk.riskTier !== "NO_DATA" && risk.atRiskUnits > 0 && (
                          <p className="text-[11px] text-slate-400 mt-1 whitespace-nowrap">
                            {risk.atRiskUnits} units · ₹{risk.potentialLoss.toLocaleString("en-IN")}
                          </p>
                        )}
                        {risk.riskTier === "SAFE" && (
                          <p className="text-[11px] text-emerald-600 mt-1">All will sell</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-400">{item.location ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {pagedExpiry.map((item) => {
                const cfg  = EXPIRY_TIER_CFG[item.tier];
                const risk = item.wasteRisk;
                const rCfg = WASTE_RISK_CFG[risk.riskTier];
                return (
                  <div key={item.id} className={cn("p-4", cfg.rowCls)}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                      </div>
                      <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", cfg.badgeCls)}>{cfg.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-2">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-600">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Expiry</span>
                        <p className="font-semibold text-slate-700 tabular-nums">
                          {fmt(item.expiryDate)} · {item.daysToExpiry <= 0 ? <span className="text-red-600">Expired</span> : `${item.daysToExpiry}d`}
                        </p>
                      </div>
                      <div><span className="text-slate-400">Stock</span><p className="font-semibold text-slate-700 tabular-nums">{item.quantity}</p></div>
                      <div><span className="text-slate-400">Location</span><p className="text-slate-500">{item.location ?? "—"}</p></div>
                    </div>
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", rCfg.cls)}>{rCfg.label}</span>
                    {risk.riskTier !== "SAFE" && risk.riskTier !== "NO_DATA" && risk.atRiskUnits > 0 && (
                      <p className="text-[11px] text-slate-400 mt-1">{risk.atRiskUnits} units · ₹{risk.potentialLoss.toLocaleString("en-IN")}</p>
                    )}
                    {risk.riskTier === "SAFE" && <p className="text-[11px] text-emerald-600 mt-1">All will sell</p>}
                  </div>
                );
              })}
            </div>
            {filteredExpiry.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
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
            <table className="w-full hidden md:table">
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
                      <td className="px-4 py-3">
                        <p className="text-[14px] font-bold text-red-600 tabular-nums">{item.quantity}</p>
                        {item.reorder.hasData ? (
                          <p className="text-[11px] text-blue-600 font-semibold mt-0.5 whitespace-nowrap">
                            📦 Order {item.reorder.suggestedQty}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-0.5">No sales data</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.reorderLevel}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.minimumStock}</td>
                      <td className="px-4 py-3">
                        <p className="text-[12px] text-slate-600 tabular-nums">₹{item.mrp.toFixed(2)}</p>
                        {item.reorder.hasData && (
                          <p className="text-[10px] text-slate-400 mt-0.5">{item.reorder.avgDailySales}/day avg</p>
                        )}
                      </td>
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

            {/* Phone cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {pagedStock.map((item) => {
                const cfg = STOCK_TIER_CFG[item.tier];
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                      </div>
                      <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", cfg.badgeCls)}>{cfg.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-3">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-600">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Stock</span>
                        <p className="font-bold text-red-600 tabular-nums">{item.quantity}</p>
                      </div>
                      <div><span className="text-slate-400">Reorder Lvl</span><p className="text-slate-500 tabular-nums">{item.reorderLevel}</p></div>
                      <div><span className="text-slate-400">Min Stock</span><p className="text-slate-500 tabular-nums">{item.minimumStock}</p></div>
                      <div><span className="text-slate-400">MRP</span><p className="text-slate-600 tabular-nums">₹{item.mrp.toFixed(2)}</p></div>
                      <div>
                        {item.reorder.hasData
                          ? <p className="text-blue-600 font-semibold">📦 Order {item.reorder.suggestedQty}</p>
                          : <p className="text-slate-400">No sales data</p>}
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(
                        `/dashboard/purchase?create-po=1&medicineId=${encodeURIComponent(item.medicine.id)}&medicine=${encodeURIComponent(item.medicine.name)}&gstRate=${item.medicine.gstRate}`
                      )}
                      className="flex items-center justify-center gap-1.5 w-full text-[12px] font-semibold text-blue-600 active:bg-blue-100 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 transition-colors"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />Create PO
                    </button>
                  </div>
                );
              })}
            </div>
            {lowItems.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
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

type PageTab = "batches" | "ledger" | "alerts" | "audit";
const VALID_TABS: PageTab[] = ["batches", "ledger", "alerts", "audit"];

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw     = searchParams.get("tab") as PageTab | null;
  const pageTab: PageTab = VALID_TABS.includes(raw as PageTab) ? (raw as PageTab) : "batches";

  const [alertCounts, setAlertCounts] = useState<AlertCounts>({ expiry: 0, lowStock: 0 });

  // Stable callback — BatchesTab and AlertsTab both call this whenever they
  // receive fresh data, so the header badge is always up-to-date regardless of
  // which tab was active when the page loaded.
  const handleCountsLoaded = useCallback((c: AlertCounts) => setAlertCounts(c), []);

  const totalAlerts = alertCounts.expiry + alertCounts.lowStock;
  const go = (t: PageTab) => setSearchParams(t === "batches" ? {} : { tab: t });

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Package2 className="w-4 h-4 text-blue-600" />
        </div>
        <h1 className="text-[18px] font-bold text-slate-900 leading-none">Inventory</h1>
        {totalAlerts > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" />
            {totalAlerts} alert{totalAlerts !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Unified tab bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-2 border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto">
        <TabBtn
          active={pageTab === "batches"} onClick={() => go("batches")}
          icon={Layers} label="Batches" color="blue"
        />
        <TabBtn
          active={pageTab === "ledger"} onClick={() => go("ledger")}
          icon={BookOpen} label="Stock Ledger" color="purple"
        />
        <TabBtn
          active={pageTab === "alerts"} onClick={() => go("alerts")}
          icon={Bell} label="Alerts" color="red" badge={totalAlerts}
        />
        <div className="h-5 w-px bg-slate-200 mx-1 flex-shrink-0" />
        <TabBtn
          active={pageTab === "audit"} onClick={() => go("audit")}
          icon={ClipboardList} label="Stock Audit" color="orange"
        />
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-h-0">
        {pageTab === "batches" && <BatchesTab onCountsLoaded={handleCountsLoaded} />}
        {pageTab === "ledger"  && <LedgerTab />}
        {pageTab === "alerts"  && <AlertsTab onCountsLoaded={handleCountsLoaded} />}
        {pageTab === "audit"   && (
          <div className="h-full overflow-auto">
            <StockAuditContent />
          </div>
        )}
      </div>
    </div>
  );
}
