import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search, Link2, Unlink, Loader2, X, PackageSearch } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { MedicineSearchResult } from "@pharmacy/types";

type Suggestion = {
  medicineId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  similarity: number;
};

type LocalMedicine = {
  id: string;
  name: string;
  manufacturer: string | null;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  hsnCode: string | null;
  gstRate: number;
  matchStatus: "PENDING" | "SUGGESTED" | "LINKED" | "KEPT_LOCAL";
  linkedMedicineId: string | null;
  linkedMedicineName: string | null;
  ambiguous: boolean;
  createdAt: string;
  suggestions: Suggestion[];
};

const STATUS_LABEL: Record<LocalMedicine["matchStatus"], string> = {
  PENDING:    "Checking…",
  SUGGESTED:  "Suggested match",
  LINKED:     "Linked",
  KEPT_LOCAL: "Local only",
};

const STATUS_BADGE: Record<LocalMedicine["matchStatus"], string> = {
  PENDING:    "bg-slate-100 text-slate-500",
  SUGGESTED:  "bg-violet-100 text-violet-700",
  LINKED:     "bg-emerald-100 text-emerald-700",
  KEPT_LOCAL: "bg-amber-100 text-amber-700",
};

/**
 * The full local-medicine directory (see PharmacyMedicine on the backend) — every
 * status, not just the fuzzy-suggested ones PendingLocalMedicinesPanel's banner
 * covers. Lets a pharmacist find and manually link a KEPT_LOCAL row (no fuzzy
 * candidate at all, so it never appears in that banner) to any global medicine by
 * name, or unlink an already-LINKED one that was matched wrong.
 *
 * Collapsed by default — this is a browse-on-demand tool, not something that needs
 * to compete with the pending-review banner for attention every time the page loads.
 */
export function LocalMedicineDirectoryPanel() {
  const isOwnerOrManager = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LocalMedicine[] | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.get<{ data: LocalMedicine[] }>("/purchases/local-medicines")
      .then(({ data }) => setItems(data.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open && items === null) load();
  }, [open, items]);

  if (!isOwnerOrManager) return null;

  function patchItem(id: string, next: Partial<LocalMedicine>) {
    setItems((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, ...next } : i)));
  }

  return (
    <div className="mx-5 mt-3 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <PackageSearch className="h-4 w-4 text-slate-400" />
        <span className="text-[13px] font-semibold text-slate-700">Local Medicines</span>
        <span className="text-[11.5px] text-slate-400">
          {items ? `${items.length} received outside the shared catalogue` : "medicines a GRN received before they were catalogued"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
            </div>
          )}
          {!loading && items && items.length === 0 && (
            <p className="py-4 text-center text-[12px] text-slate-400">No local medicines yet.</p>
          )}
          {!loading && items && items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((item) => (
                <LocalMedicineRow key={item.id} item={item} onChanged={(next) => patchItem(item.id, next)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LocalMedicineRow({ item, onChanged }: {
  item: LocalMedicine;
  onChanged: (next: Partial<LocalMedicine>) => void;
}) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  async function link(medicineId: string, name: string) {
    try {
      await api.patch(`/purchases/local-medicines/${item.id}/link`, { medicineId });
      onChanged({ matchStatus: "LINKED", linkedMedicineId: medicineId, linkedMedicineName: name });
      setPicking(false);
      toast.success(`Linked "${item.name}" to "${name}"`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not link this medicine"));
    }
  }

  async function unlink() {
    setUnlinking(true);
    try {
      await api.patch(`/purchases/local-medicines/${item.id}/unlink`);
      onChanged({ matchStatus: "KEPT_LOCAL", linkedMedicineId: null, linkedMedicineName: null });
      toast.success(`Unlinked "${item.name}"`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not unlink this medicine"));
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[12.5px] font-medium text-slate-800">{item.name}</p>
            <span className={cn("pill text-[10px] font-bold shrink-0", STATUS_BADGE[item.matchStatus])}>
              {STATUS_LABEL[item.matchStatus]}
            </span>
            {item.ambiguous && (
              <span
                title="More than one medicine in the shared catalogue has this exact name — pick the right one manually"
                className="pill bg-red-100 text-red-700 text-[10px] font-bold shrink-0"
              >
                Ambiguous
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {item.matchStatus === "LINKED" && item.linkedMedicineName
              ? `Linked to "${item.linkedMedicineName}"`
              : [item.genericName, item.strength, item.form].filter(Boolean).join(" · ") || "No additional details"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {item.matchStatus === "LINKED" ? (
            <button
              type="button"
              disabled={unlinking}
              onClick={unlink}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              {unlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              Unlink
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
            >
              <Link2 className="h-3 w-3" />
              {picking ? "Cancel" : "Search & Link"}
            </button>
          )}
        </div>
      </div>

      {picking && <CatalogPicker onPick={link} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Manual search against the global catalogue only (no includeLocal) — a link target must be a real catalogue medicine. */
function CatalogPicker({ onPick, onClose }: {
  onPick: (medicineId: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q) { setResults([]); return; }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      api.get<{ data: MedicineSearchResult[] }>("/medicines/search", { params: { q, limit: 8 } })
        .then(({ data }) => setResults(data.data ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  return (
    <div className="mt-2 rounded-lg border border-blue-100 bg-white p-2">
      <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1">
        <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the shared catalogue by name…"
          className="w-full text-[12px] text-slate-700 focus:outline-none"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300 shrink-0" />}
        <button type="button" onClick={onClose} className="shrink-0 text-slate-300 hover:text-slate-500">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {results.length > 0 && (
        <ul className="mt-1.5 max-h-48 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id, r.name)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-blue-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-slate-800">{r.name}</span>
                  <span className="block truncate text-[10.5px] text-slate-400">
                    {[r.genericName, r.manufacturer, r.strength].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-bold text-blue-500">Link</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="px-2 py-2 text-[11.5px] text-slate-400">No catalogue medicines match "{query.trim()}".</p>
      )}
    </div>
  );
}
