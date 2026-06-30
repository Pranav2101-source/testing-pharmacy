import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, Check, AlertCircle, MapPin, Tag, Trash2, Plus } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { InventoryItem, ShelfOption } from "../types";

interface CreateForm {
  rackCode:   string;
  rackName:   string;
  shelfCode:  string;
  level:      string;
}

const EMPTY_CREATE: CreateForm = { rackCode: "", rackName: "", shelfCode: "", level: "1" };

export function AssignLocationModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const initMode = item.shelf ? "shelf" : "text";
  const [mode,       setMode]       = useState<"shelf" | "text">(initMode);
  const [shelfId,    setShelfId]    = useState(item.shelfId ?? "");
  const [freeText,   setFreeText]   = useState(item.location ?? "");
  const [shelves,    setShelves]    = useState<ShelfOption[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [shelfErr,   setShelfErr]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [clearing,   setClearing]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [createErr,  setCreateErr]  = useState<string | null>(null);
  const [form,       setForm]       = useState<CreateForm>(EMPTY_CREATE);

  function loadShelves() {
    setLoading(true);
    return api.get("/locations/shelves", { params: { dropdown: true } })
      .then((r) => { setShelves(r.data.data ?? []); setShelfErr(false); })
      .catch(() => setShelfErr(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadShelves(); }, []);

  const byRack = shelves.reduce<Record<string, { rackName: string; shelves: ShelfOption[] }>>((acc, s) => {
    const key = s.rack.code;
    if (!acc[key]) acc[key] = { rackName: `${s.rack.code} — ${s.rack.name}`, shelves: [] };
    acc[key].shelves.push(s);
    return acc;
  }, {});

  async function patch(payload: object, successMsg: string) {
    try {
      await api.patch(`/inventory/${item.id}`, payload);
      onToast(successMsg, "success");
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to update location"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "shelf" && !shelfId) { setError("Please select a shelf"); return; }
    if (mode === "text"  && !freeText.trim()) { setError("Enter a location label"); return; }
    setSaving(true); setError(null);
    const payload = mode === "shelf" ? { shelfId } : { location: freeText.trim() };
    await patch(payload, `Location assigned — ${item.medicine.name}`);
    setSaving(false);
  }

  async function clearLocation() {
    setClearing(true); setError(null);
    await patch({ shelfId: null, location: null }, `Location cleared — ${item.medicine.name}`);
    setClearing(false);
  }

  async function createAndSelect(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    const { rackCode, rackName, shelfCode, level } = form;
    if (!rackCode.trim()) { setCreateErr("Rack code is required"); return; }
    if (!rackName.trim()) { setCreateErr("Rack name is required"); return; }
    if (!shelfCode.trim()) { setCreateErr("Shelf code is required"); return; }
    if (!level || Number(level) < 1) { setCreateErr("Level must be ≥ 1"); return; }
    setCreating(true);
    try {
      const rackRes = await api.post("/locations/racks", {
        code: rackCode.trim().toUpperCase(),
        name: rackName.trim(),
      });
      const rackId = rackRes.data.data.id as string;
      const shelfRes = await api.post("/locations/shelves", {
        rackId,
        code:  shelfCode.trim().toUpperCase(),
        level: Number(level),
      });
      const newShelfId = shelfRes.data.data.id as string;
      await loadShelves();
      setShelfId(newShelfId);
      setShowCreate(false);
      setForm(EMPTY_CREATE);
      setMode("shelf");
    } catch (err: any) {
      setCreateErr(getErrorMessage(err, "Failed to create rack/shelf"));
    } finally {
      setCreating(false);
    }
  }

  const hasLocation = !!(item.shelf || item.location);
  const busy        = saving || clearing;
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
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Assign Location</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">
              {item.medicine.name} · Batch {item.batchNumber}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <MapPin className="w-3 h-3 text-slate-400" />
              <span className="text-[11px] text-slate-500">
                Current: <span className="font-semibold text-slate-700">{currentLabel}</span>
              </span>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center mt-0.5">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden text-[13px]">
            {([
              { key: "shelf" as const, label: "Shelf / Rack", icon: MapPin },
              { key: "text"  as const, label: "Free Text",    icon: Tag    },
            ]).map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => { setMode(key); setError(null); setShowCreate(false); }}
                className={cn(
                  "flex-1 py-2.5 font-semibold transition-all flex items-center justify-center gap-1.5",
                  mode === key ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50",
                )}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Shelf picker */}
          {mode === "shelf" && (
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Select Shelf</label>

              {loading ? (
                <div className="flex items-center gap-2 text-[13px] text-slate-400 py-2.5 px-3 rounded-lg bg-slate-50 border border-slate-100">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading shelves…
                </div>
              ) : shelfErr ? (
                <div className="flex items-center gap-2 text-[13px] text-red-500 py-2.5 px-3 rounded-lg bg-red-50 border border-red-100">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> Failed to load shelves.
                </div>
              ) : shelves.length === 0 && !showCreate ? (
                <div className="text-[13px] text-slate-500 py-3 px-3 rounded-lg bg-slate-50 border border-slate-100 text-center leading-relaxed">
                  No shelves yet.{" "}
                  <button type="button" onClick={() => setShowCreate(true)}
                    className="text-blue-600 font-semibold hover:underline">
                    Create your first rack &amp; shelf ↓
                  </button>
                </div>
              ) : !showCreate && (
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

              {/* Add new shelf button (when shelves exist and form not open) */}
              {!showCreate && shelves.length > 0 && (
                <button type="button" onClick={() => { setShowCreate(true); setCreateErr(null); }}
                  className="flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-700 font-medium">
                  <Plus className="w-3.5 h-3.5" /> Add new shelf
                </button>
              )}

              {/* Inline create form */}
              <AnimatePresence>
                {showCreate && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                      <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
                        <Plus className="w-3 h-3" /> New Rack &amp; Shelf
                      </p>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Rack Code *</label>
                          <input
                            type="text" placeholder="A1" maxLength={20}
                            value={form.rackCode}
                            onChange={(e) => setForm((f) => ({ ...f, rackCode: e.target.value.toUpperCase() }))}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Rack Name *</label>
                          <input
                            type="text" placeholder="Front Rack" maxLength={100}
                            value={form.rackName}
                            onChange={(e) => setForm((f) => ({ ...f, rackName: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Shelf Code *</label>
                          <input
                            type="text" placeholder="S1" maxLength={20}
                            value={form.shelfCode}
                            onChange={(e) => setForm((f) => ({ ...f, shelfCode: e.target.value.toUpperCase() }))}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Level</label>
                          <input
                            type="number" min={1} placeholder="1"
                            value={form.level}
                            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
                          />
                        </div>
                      </div>

                      {createErr && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-600">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {createErr}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-0.5">
                        <button type="button" onClick={() => { setShowCreate(false); setCreateErr(null); setForm(EMPTY_CREATE); }}
                          className="flex-1 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-500 font-medium hover:bg-white transition-colors">
                          Cancel
                        </button>
                        <button type="button" onClick={createAndSelect} disabled={creating}
                          className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5 transition-colors">
                          {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Create &amp; Select
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Free-text */}
          {mode === "text" && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Location Label</label>
              <input type="text" value={freeText} onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. Aisle 3, Cold Room, Counter B"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            {hasLocation ? (
              <button type="button" onClick={clearLocation} disabled={busy}
                className="flex items-center gap-1.5 text-[12px] text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors">
                {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Clear location
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy}
                className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={busy || showCreate}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save Location
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
