import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutGrid, Plus, X, Pencil, Check, ChevronRight,
  Building2, Layers, Loader2, FileX, ToggleLeft, ToggleRight,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type Rack = {
  id: string; code: string; name: string; aisle: string | null; isActive: boolean;
  shelves: { id: string }[];
};

type Shelf = {
  id: string; code: string; level: number; description: string | null; isActive: boolean;
  rack: { id: string; code: string; name: string };
};

// ─── Rack Modal ──────────────────────────────────────────────────────────────

function RackModal({ rack, onClose, onDone }: { rack?: Rack; onClose: () => void; onDone: () => void }) {
  const [code,   setCode]   = useState(rack?.code   ?? "");
  const [name,   setName]   = useState(rack?.name   ?? "");
  const [aisle,  setAisle]  = useState(rack?.aisle  ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) { setError("Code and Name are required"); return; }
    setSaving(true); setError(null);
    try {
      if (rack) {
        await api.patch(`/locations/racks/${rack.id}`, { code: code.toUpperCase(), name, aisle: aisle || undefined });
      } else {
        await api.post("/locations/racks", { code: code.toUpperCase(), name, aisle: aisle || undefined });
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to save rack");
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
          <h2 className="text-[15px] font-bold text-slate-900">{rack ? "Edit Rack" : "Add Rack"}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Code *</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="R1"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 uppercase" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Aisle</label>
              <input value={aisle} onChange={(e) => setAisle(e.target.value)} placeholder="Main Aisle"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Antibiotics Aisle"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-[13px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {rack ? "Save Changes" : "Add Rack"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Shelf Modal ─────────────────────────────────────────────────────────────

function ShelfModal({ shelf, racks, defaultRackId, onClose, onDone }: {
  shelf?: Shelf; racks: Rack[]; defaultRackId?: string; onClose: () => void; onDone: () => void;
}) {
  const [rackId,      setRackId]      = useState(shelf?.rack.id ?? defaultRackId ?? "");
  const [code,        setCode]        = useState(shelf?.code        ?? "");
  const [level,       setLevel]       = useState(shelf?.level?.toString() ?? "1");
  const [description, setDescription] = useState(shelf?.description ?? "");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rackId) { setError("Rack is required"); return; }
    if (!code.trim()) { setError("Code is required"); return; }
    if (isNaN(parseInt(level)) || parseInt(level) < 1) { setError("Level must be a positive number"); return; }
    setSaving(true); setError(null);
    try {
      const payload = { rackId, code: code.toUpperCase(), level: parseInt(level), description: description || undefined };
      if (shelf) {
        await api.patch(`/locations/shelves/${shelf.id}`, { code: payload.code, level: payload.level, description: payload.description });
      } else {
        await api.post("/locations/shelves", payload);
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to save shelf");
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
          <h2 className="text-[15px] font-bold text-slate-900">{shelf ? "Edit Shelf" : "Add Shelf"}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          {!shelf && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Rack *</label>
              <select value={rackId} onChange={(e) => setRackId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white">
                <option value="">Select rack…</option>
                {racks.filter((r) => r.isActive).map((r) => (
                  <option key={r.id} value={r.id}>{r.code} — {r.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Code *</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 uppercase" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Level *</label>
              <input type="number" value={level} min={1} onChange={(e) => setLevel(e.target.value)} placeholder="1"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Bottom shelf, cold storage…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-[13px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {shelf ? "Save Changes" : "Add Shelf"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const [racks,          setRacks]          = useState<Rack[]>([]);
  const [shelves,        setShelves]        = useState<Shelf[]>([]);
  const [selectedRack,   setSelectedRack]   = useState<Rack | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [editRack,       setEditRack]       = useState<Rack | null>(null);
  const [editShelf,      setEditShelf]      = useState<Shelf | null>(null);
  const [showRackModal,  setShowRackModal]  = useState(false);
  const [showShelfModal, setShowShelfModal] = useState(false);

  const loadRacks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/locations/racks", { params: { limit: 100, includeInactive: true } });
      setRacks(res.data.data.items ?? []);
    } finally { setLoading(false); }
  }, []);

  const loadShelves = useCallback(async (rackId: string) => {
    const res = await api.get("/locations/shelves", { params: { limit: 100, includeInactive: true } });
    const all: Shelf[] = res.data.data.items ?? [];
    setShelves(all.filter((s) => s.rack.id === rackId));
  }, []);

  useEffect(() => { loadRacks(); }, [loadRacks]);

  useEffect(() => {
    if (selectedRack) loadShelves(selectedRack.id);
    else setShelves([]);
  }, [selectedRack, loadShelves]);

  async function toggleRack(rack: Rack) {
    await api.patch(`/locations/racks/${rack.id}`, { isActive: !rack.isActive });
    loadRacks();
  }

  async function toggleShelf(shelf: Shelf) {
    await api.patch(`/locations/shelves/${shelf.id}`, { isActive: !shelf.isActive });
    if (selectedRack) loadShelves(selectedRack.id);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Locations</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Manage pharmacy racks and shelf positions</p>
        </div>
        <button onClick={() => { setEditRack(null); setShowRackModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> Add Rack
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px,1fr] gap-6">

        {/* Left — Rack list */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">Racks</span>
            <span className="ml-auto text-[11px] text-slate-400">{racks.filter((r) => r.isActive).length} active</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
            </div>
          ) : racks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
              <FileX className="w-8 h-8" />
              <span className="text-[13px]">No racks yet</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {racks.map((rack) => (
                <div key={rack.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors",
                    selectedRack?.id === rack.id && "bg-blue-50",
                  )}
                  onClick={() => setSelectedRack(rack.id === selectedRack?.id ? null : rack)}
                >
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-bold",
                    rack.isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400")}>
                    {rack.code}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{rack.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {rack.aisle && `${rack.aisle} · `}{rack.shelves.length} shelf{rack.shelves.length !== 1 ? "ves" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setEditRack(rack); setShowRackModal(true); }}
                      className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleRack(rack)}
                      className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center transition-colors"
                      title={rack.isActive ? "Deactivate" : "Activate"}>
                      {rack.isActive
                        ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                        : <ToggleLeft  className="w-4 h-4 text-slate-300" />}
                    </button>
                    <ChevronRight className={cn("w-4 h-4 text-slate-300 transition-transform", selectedRack?.id === rack.id && "rotate-90")} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — Shelves in selected rack */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">
              {selectedRack ? `Shelves — ${selectedRack.code} (${selectedRack.name})` : "Shelves"}
            </span>
            {selectedRack && (
              <button onClick={() => { setEditShelf(null); setShowShelfModal(true); }}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add Shelf
              </button>
            )}
          </div>

          {!selectedRack ? (
            <div className="flex flex-col items-center justify-center h-60 text-slate-400 gap-2">
              <LayoutGrid className="w-8 h-8" />
              <span className="text-[13px]">Select a rack to see its shelves</span>
            </div>
          ) : shelves.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-slate-400 gap-2">
              <FileX className="w-8 h-8" />
              <span className="text-[13px]">No shelves in this rack</span>
              <button onClick={() => { setEditShelf(null); setShowShelfModal(true); }}
                className="text-[12px] text-blue-600 font-semibold hover:underline">Add first shelf</button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {shelves.sort((a, b) => a.level - b.level || a.code.localeCompare(b.code)).map((shelf) => (
                <div key={shelf.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-[12px] font-bold",
                    shelf.isActive ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400")}>
                    {shelf.code}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800">Level {shelf.level}</div>
                    <div className="text-[11px] text-slate-400 truncate">{shelf.description || "No description"}</div>
                  </div>
                  {!shelf.isActive && (
                    <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditShelf(shelf); setShowShelfModal(true); }}
                      className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleShelf(shelf)}
                      className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center transition-colors">
                      {shelf.isActive
                        ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                        : <ToggleLeft  className="w-4 h-4 text-slate-300" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showRackModal && (
          <RackModal
            rack={editRack ?? undefined}
            onClose={() => { setShowRackModal(false); setEditRack(null); }}
            onDone={() => { setShowRackModal(false); setEditRack(null); loadRacks(); }}
          />
        )}
        {showShelfModal && (
          <ShelfModal
            shelf={editShelf ?? undefined}
            racks={racks}
            defaultRackId={selectedRack?.id}
            onClose={() => { setShowShelfModal(false); setEditShelf(null); }}
            onDone={() => {
              setShowShelfModal(false); setEditShelf(null);
              if (selectedRack) loadShelves(selectedRack.id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
