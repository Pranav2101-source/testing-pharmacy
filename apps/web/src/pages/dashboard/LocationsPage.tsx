import { useState, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListSkeleton } from "@/components/Skeleton";
import {
  LayoutGrid, Plus, X, Pencil, Loader2, FileX,
  Building2, Layers, Package, Search, ToggleLeft, ToggleRight,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type Rack = {
  id: string; code: string; name: string; aisle: string | null; isActive: boolean;
  shelves: { id: string }[];
};

type Shelf = {
  id: string; code: string; level: number; description: string | null; isActive: boolean;
  rack: { id: string; code: string; name: string };
  _count?: { inventory: number };
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
      setError(getErrorMessage(err, "Failed to save rack"));
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
            <h2 className="text-[15px] font-bold text-slate-900">{rack ? "Edit Rack" : "Add Rack"}</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">A rack is a physical shelving unit in your pharmacy</p>
          </div>
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
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Aisle / Zone</label>
              <input value={aisle} onChange={(e) => setAisle(e.target.value)} placeholder="Main Aisle"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Antibiotics, Cold Storage, Front Counter"
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
      setError(getErrorMessage(err, "Failed to save shelf"));
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
            <h2 className="text-[15px] font-bold text-slate-900">{shelf ? "Edit Shelf" : "Add Shelf"}</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Level 1 = bottom shelf, higher = further up the rack</p>
          </div>
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
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Bottom shelf, Cold storage, Eye drops"
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

// ─── Stat Chip ────────────────────────────────────────────────────────────────

function StatChip({ icon: Icon, label, value, cls }: {
  icon: React.ElementType; label: string; value: number; cls?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 px-4 py-2.5 rounded-xl border", cls ?? "bg-white border-slate-200")}>
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
      </div>
      <div>
        <div className="text-[18px] font-bold text-slate-800 leading-none">{value}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const [racks,          setRacks]          = useState<Rack[]>([]);
  const [allShelves,     setAllShelves]     = useState<Shelf[]>([]);
  const [selectedRack,   setSelectedRack]   = useState<Rack | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [editRack,       setEditRack]       = useState<Rack | null>(null);
  const [editShelf,      setEditShelf]      = useState<Shelf | null>(null);
  const [showRackModal,  setShowRackModal]  = useState(false);
  const [showShelfModal, setShowShelfModal] = useState(false);
  const [rackSearch,     setRackSearch]     = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rackRes, shelfRes] = await Promise.all([
        api.get("/locations/racks",   { params: { limit: 200, includeInactive: true } }),
        api.get("/locations/shelves", { params: { limit: 500, includeInactive: true } }),
      ]);
      setRacks(rackRes.data.data.items ?? []);
      setAllShelves(shelfRes.data.data.items ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Sync selectedRack when racks reload
  useEffect(() => {
    if (selectedRack) {
      const refreshed = racks.find((r) => r.id === selectedRack.id);
      if (refreshed) setSelectedRack(refreshed);
    }
  }, [racks]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleRack(rack: Rack) {
    await api.patch(`/locations/racks/${rack.id}`, { isActive: !rack.isActive });
    loadAll();
  }

  async function toggleShelf(shelf: Shelf) {
    await api.patch(`/locations/shelves/${shelf.id}`, { isActive: !shelf.isActive });
    loadAll();
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const filteredRacks = useMemo(() => {
    const q = rackSearch.toLowerCase();
    if (!q) return racks;
    return racks.filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) ||
             (r.aisle ?? "").toLowerCase().includes(q),
    );
  }, [racks, rackSearch]);

  const shelvesForRack = useCallback((rackId: string) =>
    allShelves
      .filter((s) => s.rack.id === rackId)
      .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code)),
  [allShelves]);

  const batchesForRack = useCallback((rackId: string) =>
    allShelves
      .filter((s) => s.rack.id === rackId && s.isActive)
      .reduce((sum, s) => sum + (s._count?.inventory ?? 0), 0),
  [allShelves]);

  const stats = useMemo(() => ({
    activeRacks:   racks.filter((r) => r.isActive).length,
    activeShelves: allShelves.filter((s) => s.isActive).length,
    totalBatches:  allShelves.filter((s) => s.isActive).reduce((sum, s) => sum + (s._count?.inventory ?? 0), 0),
  }), [racks, allShelves]);

  const selectedShelves = selectedRack ? shelvesForRack(selectedRack.id) : [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Locations</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Map every inventory batch to a rack and shelf position</p>
        </div>
        <button onClick={() => { setEditRack(null); setShowRackModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Add Rack
        </button>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <StatChip icon={Building2} label="Active Racks"   value={stats.activeRacks}   />
        <StatChip icon={Layers}    label="Active Shelves" value={stats.activeShelves} />
        <StatChip icon={Package}   label="Batches Placed" value={stats.totalBatches}
          cls="bg-blue-50 border-blue-200" />
      </div>

      {/* ── Two-panel layout ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-5">

        {/* ── Left: Rack list ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">Racks</span>
            <span className="ml-auto text-[11px] text-slate-400">{stats.activeRacks} active</span>
          </div>

          {/* Search */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 h-8">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <input value={rackSearch} onChange={(e) => setRackSearch(e.target.value)}
                placeholder="Search racks…" className="flex-1 bg-transparent text-[13px] text-slate-700 placeholder-slate-400 focus:outline-none" />
            </div>
          </div>

          {loading ? (
            <ListSkeleton />
          ) : filteredRacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
              <FileX className="w-8 h-8" />
              <span className="text-[13px]">{rackSearch ? "No racks match your search" : "No racks yet"}</span>
              {!rackSearch && (
                <button onClick={() => { setEditRack(null); setShowRackModal(true); }}
                  className="text-[12px] text-blue-600 font-semibold hover:underline">Add first rack</button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-50 overflow-y-auto flex-1">
              {filteredRacks.map((rack) => {
                const shelfCount = rack.shelves.length;
                const batchCount = batchesForRack(rack.id);
                const isSelected = selectedRack?.id === rack.id;
                return (
                  <div key={rack.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors",
                      isSelected ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-slate-50 border-l-2 border-l-transparent",
                      !rack.isActive && "opacity-60",
                    )}
                    onClick={() => setSelectedRack(rack.id === selectedRack?.id ? null : rack)}
                  >
                    {/* Code badge */}
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold flex-shrink-0",
                      rack.isActive
                        ? isSelected ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-400",
                    )}>
                      {rack.code}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{rack.name}</span>
                        {!rack.isActive && (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">INACTIVE</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {rack.aisle && (
                          <span className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md font-medium">{rack.aisle}</span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {shelfCount} shelf{shelfCount !== 1 ? "ves" : ""}
                          {batchCount > 0 && ` · ${batchCount} batches`}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setEditRack(rack); setShowRackModal(true); }}
                        title="Edit rack"
                        className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleRack(rack)} title={rack.isActive ? "Deactivate" : "Activate"}
                        className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center transition-colors">
                        {rack.isActive
                          ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                          : <ToggleLeft  className="w-4 h-4 text-slate-300" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: Shelves in selected rack ──────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">
              {selectedRack
                ? <>{selectedRack.code} — {selectedRack.name}</>
                : "Shelves"}
            </span>
            {selectedRack && (
              <>
                <span className="text-[11px] text-slate-400 ml-1">
                  {selectedShelves.filter((s) => s.isActive).length} active shelves
                  {batchesForRack(selectedRack.id) > 0 && ` · ${batchesForRack(selectedRack.id)} batches`}
                </span>
                <button onClick={() => { setEditShelf(null); setShowShelfModal(true); }}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Shelf
                </button>
              </>
            )}
          </div>

          {!selectedRack ? (
            <div className="flex flex-col items-center justify-center flex-1 h-60 text-slate-400 gap-3">
              <LayoutGrid className="w-10 h-10 text-slate-200" />
              <div className="text-center">
                <p className="text-[14px] font-semibold text-slate-500">Select a rack</p>
                <p className="text-[12px] text-slate-400 mt-0.5">Click any rack on the left to view and manage its shelves</p>
              </div>
            </div>
          ) : selectedShelves.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 h-60 text-slate-400 gap-3">
              <Layers className="w-10 h-10 text-slate-200" />
              <div className="text-center">
                <p className="text-[14px] font-semibold text-slate-500">No shelves yet</p>
                <p className="text-[12px] text-slate-400 mt-0.5">Add shelves to start placing inventory batches on this rack</p>
              </div>
              <button onClick={() => { setEditShelf(null); setShowShelfModal(true); }}
                className="text-[12px] text-blue-600 font-semibold hover:underline">Add first shelf</button>
            </div>
          ) : (
            <>
              {/* Shelf table header */}
              <div className="grid grid-cols-[56px,80px,1fr,100px,90px,80px] items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                <span>Level</span>
                <span>Code</span>
                <span>Description</span>
                <span className="text-center">Batches</span>
                <span className="text-center">Status</span>
                <span />
              </div>

              <div className="divide-y divide-slate-50 overflow-y-auto flex-1">
                {selectedShelves.map((shelf) => {
                  const batchCount = shelf._count?.inventory ?? 0;
                  return (
                    <div key={shelf.id}
                      className={cn(
                        "grid grid-cols-[56px,80px,1fr,100px,90px,80px] items-center px-4 py-3 hover:bg-slate-50 transition-colors",
                        !shelf.isActive && "opacity-60",
                      )}>
                      {/* Level */}
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-100 w-10 h-6 rounded-md flex items-center justify-center">
                        Lv.{shelf.level}
                      </span>

                      {/* Code */}
                      <span className={cn(
                        "inline-flex items-center justify-center w-10 h-8 rounded-lg text-[13px] font-bold",
                        shelf.isActive ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400",
                      )}>
                        {shelf.code}
                      </span>

                      {/* Description */}
                      <span className="text-[13px] text-slate-600 truncate pr-3">
                        {shelf.description || <span className="text-slate-300 italic">No description</span>}
                      </span>

                      {/* Batch count */}
                      <div className="text-center">
                        {batchCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            <Package className="w-3 h-3" />{batchCount}
                          </span>
                        ) : (
                          <span className="text-[12px] text-slate-300">—</span>
                        )}
                      </div>

                      {/* Status */}
                      <div className="flex justify-center">
                        {shelf.isActive ? (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Active</span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Inactive</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditShelf(shelf); setShowShelfModal(true); }}
                          title="Edit shelf"
                          className="w-7 h-7 rounded-lg hover:bg-blue-100 flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleShelf(shelf)} title={shelf.isActive ? "Deactivate" : "Activate"}
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors">
                          {shelf.isActive
                            ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                            : <ToggleLeft  className="w-4 h-4 text-slate-300" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showRackModal && (
          <RackModal
            rack={editRack ?? undefined}
            onClose={() => { setShowRackModal(false); setEditRack(null); }}
            onDone={() => { setShowRackModal(false); setEditRack(null); loadAll(); }}
          />
        )}
        {showShelfModal && (
          <ShelfModal
            shelf={editShelf ?? undefined}
            racks={racks}
            defaultRackId={selectedRack?.id}
            onClose={() => { setShowShelfModal(false); setEditShelf(null); }}
            onDone={() => { setShowShelfModal(false); setEditShelf(null); loadAll(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
