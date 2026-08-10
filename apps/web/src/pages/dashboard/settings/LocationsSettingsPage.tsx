import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Plus, ChevronDown, ChevronRight, Loader2, AlertCircle, Check, Pencil, X } from "lucide-react";
import { api, getErrorMessage, unwrapList } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Shelf {
  id:    string;
  code:  string;
  level: number;
  description: string | null;
  isActive: boolean;
}

interface Rack {
  id:       string;
  code:     string;
  name:     string;
  aisle:    string | null;
  isActive: boolean;
  shelves:  Shelf[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, mono, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; maxLength?: number;
}) {
  return (
    <input
      type="text" value={value} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white",
        mono && "font-mono",
      )}
    />
  );
}

// ─── Add Rack inline form ─────────────────────────────────────────────────────

function AddRackForm({ onCreated, onCancel }: { onCreated: (rack: Rack) => void; onCancel: () => void }) {
  const [code,    setCode]    = useState("");
  const [name,    setName]    = useState("");
  const [aisle,   setAisle]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError("Rack code is required"); return; }
    if (!name.trim()) { setError("Rack name is required"); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post("/locations/racks", {
        code:  code.trim().toUpperCase(),
        name:  name.trim(),
        ...(aisle.trim() ? { aisle: aisle.trim() } : {}),
      });
      onCreated({ ...res.data.data, shelves: [] });
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create rack"));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">New Rack</p>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Code *">
          <Input value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="A1" mono maxLength={20} />
        </FieldRow>
        <FieldRow label="Name *">
          <Input value={name} onChange={setName} placeholder="Front Rack" maxLength={100} />
        </FieldRow>
        <FieldRow label="Aisle">
          <Input value={aisle} onChange={setAisle} placeholder="Aisle 1 (optional)" maxLength={50} />
        </FieldRow>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving}
          className="flex-1 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-white transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-1.5 transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Create Rack
        </button>
      </div>
    </form>
  );
}

// ─── Add Shelf inline form ────────────────────────────────────────────────────

function AddShelfForm({ rackId, onCreated, onCancel }: {
  rackId: string; onCreated: (shelf: Shelf) => void; onCancel: () => void;
}) {
  const [code,   setCode]   = useState("");
  const [level,  setLevel]  = useState("1");
  const [desc,   setDesc]   = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError("Shelf code is required"); return; }
    if (!level || Number(level) < 1) { setError("Level must be ≥ 1"); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post("/locations/shelves", {
        rackId,
        code:  code.trim().toUpperCase(),
        level: Number(level),
        ...(desc.trim() ? { description: desc.trim() } : {}),
      });
      onCreated(res.data.data);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create shelf"));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="ml-6 mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">New Shelf</p>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Code *">
          <Input value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="S1" mono maxLength={20} />
        </FieldRow>
        <FieldRow label="Level">
          <input type="number" min={1} value={level} onChange={(e) => setLevel(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white" />
        </FieldRow>
        <div className="col-span-2">
          <FieldRow label="Description">
            <Input value={desc} onChange={setDesc} placeholder="Optional notes" maxLength={200} />
          </FieldRow>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving}
          className="flex-1 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-slate-700 text-white text-[12px] font-semibold hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-1.5">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Add Shelf
        </button>
      </div>
    </form>
  );
}

// ─── Rack row ─────────────────────────────────────────────────────────────────

function RackRow({ rack, onUpdate }: { rack: Rack; onUpdate: (r: Rack) => void }) {
  const [open,        setOpen]        = useState(false);
  const [addingShelf, setAddingShelf] = useState(false);

  function handleShelfCreated(shelf: Shelf) {
    setAddingShelf(false);
    onUpdate({ ...rack, shelves: [...rack.shelves, shelf] });
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Rack header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-bold text-slate-800 font-mono">{rack.code}</span>
          <span className="text-[13px] text-slate-500 ml-2">— {rack.name}</span>
          {rack.aisle && <span className="text-[11px] text-slate-400 ml-2">· {rack.aisle}</span>}
        </div>
        <span className="text-[11px] text-slate-400">{rack.shelves.length} shelf{rack.shelves.length !== 1 ? "ves" : ""}</span>
      </button>

      {/* Shelf list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 bg-slate-50 border-t border-slate-100 space-y-2">
              {rack.shelves.length === 0 && !addingShelf && (
                <p className="text-[12px] text-slate-400 py-2">No shelves yet.</p>
              )}
              {rack.shelves.map((shelf) => (
                <div key={shelf.id}
                  className="flex items-center gap-3 ml-6 py-1.5 px-3 bg-white rounded-lg border border-slate-100 text-[12px]">
                  <span className="font-mono font-semibold text-slate-700">{rack.code}/{shelf.code}</span>
                  <span className="text-slate-400">Level {shelf.level}</span>
                  {shelf.description && <span className="text-slate-400 truncate">{shelf.description}</span>}
                </div>
              ))}

              {addingShelf ? (
                <AddShelfForm
                  rackId={rack.id}
                  onCreated={handleShelfCreated}
                  onCancel={() => setAddingShelf(false)}
                />
              ) : (
                <button type="button" onClick={() => setAddingShelf(true)}
                  className="ml-6 flex items-center gap-1.5 text-[12px] text-blue-600 hover:text-blue-700 font-medium py-1">
                  <Plus className="w-3.5 h-3.5" /> Add shelf
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LocationsSettingsPage() {
  const [racks,     setRacks]     = useState<Rack[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [addingRack, setAddingRack] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [racksRes, shelvesRes] = await Promise.all([
        // Both endpoints return the paginated envelope and default to 50 per page, so
        // an unpaged read silently truncated a pharmacy with more racks than that.
        api.get("/locations/racks",   { params: { limit: 500 } }),
        api.get("/locations/shelves", { params: { limit: 500 } }),
      ]);
      // unwrapList, not `data.data ?? []`: this endpoint returns { items, total, … },
      // so the raw value is an object and `.filter` on it threw during render.
      const allShelves = unwrapList<Shelf & { rack: { id: string } | null }>(shelvesRes.data?.data);
      const rackList   = unwrapList<Rack>(racksRes.data?.data);
      setRacks(rackList.map((r) => ({
        ...r,
        shelves: allShelves.filter((s) => s.rack?.id === r.id),
      })));
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to load locations"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleRackCreated(rack: Rack) {
    setRacks((rs) => [...rs, rack]);
    setAddingRack(false);
  }

  function handleRackUpdated(rack: Rack) {
    setRacks((rs) => rs.map((r) => r.id === rack.id ? rack : r));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-500" /> Rack &amp; Shelf Locations
            </h1>
            <p className="text-[12px] text-slate-400 mt-0.5">
              Organise your inventory by physical storage location.
            </p>
          </div>
          {!addingRack && (
            <button onClick={() => setAddingRack(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
              <Plus className="w-4 h-4" /> Add Rack
            </button>
          )}
        </div>

        {/* Add rack form */}
        <AnimatePresence>
          {addingRack && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <AddRackForm
                onCreated={handleRackCreated}
                onCancel={() => setAddingRack(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px]">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        ) : racks.length === 0 && !addingRack ? (
          <div className="text-center py-16">
            <MapPin className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-slate-400">No racks yet</p>
            <p className="text-[12px] text-slate-300 mt-1">Add your first rack to start organising inventory by location.</p>
            <button onClick={() => setAddingRack(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors mx-auto">
              <Plus className="w-4 h-4" /> Add First Rack
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {racks.map((rack) => (
              <RackRow key={rack.id} rack={rack} onUpdate={handleRackUpdated} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
