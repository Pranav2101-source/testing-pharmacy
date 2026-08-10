import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, Check, AlertCircle, MapPin, Tag, Trash2, Plus } from "lucide-react";
import { api, getErrorMessage, unwrapList } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { InventoryItem, ShelfOption } from "../types";

interface CreateForm {
  rackCode:   string;
  rackName:   string;
  shelfCode:  string;
  level:      string;
}

type RackOption = { id: string; code: string; name: string };

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
  const [racks,      setRacks]      = useState<RackOption[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [shelfErr,   setShelfErr]   = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [clearing,   setClearing]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [createErr,  setCreateErr]  = useState<string | null>(null);
  const [form,       setForm]       = useState<CreateForm>(EMPTY_CREATE);

  async function loadShelves() {
    setLoading(true);
    try {
      // limit, not the old `dropdown: true`: the API has no such parameter and quietly
      // ignored it, so this picker only ever saw the default first page of 50 shelves.
      const [shelfRes, rackRes] = await Promise.all([
        api.get("/locations/shelves", { params: { limit: 500 } }),
        // Racks are needed as well as shelves so "Add new shelf" can attach to a rack
        // that exists but has no shelves yet — deriving racks from the shelf list alone
        // would make that rack invisible and the create always collide on its code.
        api.get("/locations/racks", { params: { limit: 500 } }),
      ]);
      setShelves(unwrapList<ShelfOption>(shelfRes.data?.data));
      setRacks(unwrapList<RackOption>(rackRes.data?.data));
      setShelfErr(null);
    } catch (err) {
      setShelfErr(getErrorMessage(err, "Failed to load shelves"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadShelves(); }, []);

  // A shelf whose rack could not be resolved is skipped rather than grouped: the API
  // returns `rack: null` in that case, and reading `.code` off it threw during render,
  // taking the whole modal down with it.
  const byRack = shelves.reduce<Record<string, { rackName: string; shelves: ShelfOption[] }>>((acc, s) => {
    if (!s?.rack?.code) return acc;
    const key = s.rack.code;
    if (!acc[key]) acc[key] = { rackName: `${s.rack.code} — ${s.rack.name}`, shelves: [] };
    acc[key].shelves.push(s);
    return acc;
  }, {});

  // Racks known from the racks list, plus any rack referenced by a shelf — the two
  // can differ if a rack was created between the two requests.
  const typedRackCode = form.rackCode.trim().toUpperCase();
  const existingRack  = !typedRackCode ? undefined
    : racks.find((r) => r.code?.toUpperCase() === typedRackCode)
      ?? shelves.find((s) => s.rack?.code?.toUpperCase() === typedRackCode)?.rack;

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
    const code      = form.rackCode.trim().toUpperCase();
    const shelfCode = form.shelfCode.trim().toUpperCase();
    const level     = Number(form.level);

    if (!code)      { setCreateErr("Rack code is required"); return; }
    if (!shelfCode) { setCreateErr("Shelf code is required"); return; }
    if (!form.level || !Number.isInteger(level) || level < 1) { setCreateErr("Level must be a whole number, 1 or more"); return; }

    // The rack only needs a name when it is actually being created. Requiring one for
    // an existing rack — and then POSTing it anyway — is what made every second shelf
    // fail with "A rack with this code already exists".
    if (!existingRack && !form.rackName.trim()) { setCreateErr("Rack name is required for a new rack"); return; }

    // Caught here rather than at the API: the server's message ("A shelf with this
    // code already exists") is true but doesn't say the shelf is already in the list
    // right above the form.
    const duplicate = shelves.find((s) => s.code?.toUpperCase() === shelfCode);
    if (duplicate) {
      setCreateErr(`Shelf ${shelfCode} already exists — pick it from the list above.`);
      return;
    }

    setCreating(true);
    try {
      let rackId = existingRack?.id;
      if (!rackId) {
        const rackRes = await api.post("/locations/racks", { code, name: form.rackName.trim() });
        rackId = rackRes.data?.data?.id as string;
      }
      const shelfRes = await api.post("/locations/shelves", { rackId, code: shelfCode, level });
      const newShelfId = shelfRes.data?.data?.id as string | undefined;

      await loadShelves();
      // Only select what the server actually confirmed. Assigning an undefined id
      // would submit `{ shelfId: undefined }` and silently clear the location instead.
      if (newShelfId) setShelfId(newShelfId);
      setShowCreate(false);
      setForm(EMPTY_CREATE);
      setMode("shelf");
      setError(null);
    } catch (err) {
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
                <div className="flex items-start gap-2 text-[13px] text-red-600 py-2.5 px-3 rounded-lg bg-red-50 border border-red-100">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>{shelfErr}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <button type="button" onClick={loadShelves} className="text-[12px] font-semibold text-red-700 hover:underline">
                        Retry
                      </button>
                      <button type="button" onClick={() => { setMode("text"); setError(null); }} className="text-[12px] font-semibold text-slate-500 hover:underline">
                        Use a free-text label instead
                      </button>
                    </div>
                  </div>
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
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                            Rack Name {existingRack ? "" : "*"}
                          </label>
                          <input
                            type="text" placeholder="Front Rack" maxLength={100}
                            value={existingRack ? existingRack.name : form.rackName}
                            disabled={!!existingRack}
                            onChange={(e) => setForm((f) => ({ ...f, rackName: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white disabled:bg-slate-100 disabled:text-slate-500"
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

                      {existingRack && (
                        <p className="text-[11px] text-blue-700 bg-white/70 border border-blue-200 rounded-lg px-2.5 py-1.5">
                          Rack <span className="font-bold">{existingRack.code}</span> already exists — the new shelf
                          will be added to it.
                        </p>
                      )}

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
