import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, X, Check, AlertCircle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { InventoryItem, ShelfOption } from "../types";

export function AssignLocationModal({ item, onClose, onDone, onToast }: {
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
