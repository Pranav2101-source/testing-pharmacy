import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Scissors, Sparkles, X, AlertTriangle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { parsePackSize } from "@/lib/packSize";
import type { InventoryItem } from "@/pages/inventory/types";

/**
 * "Enable loose selling" from Inventory — the screen this whole flow was missing.
 *
 * <p>The Medicines-page bulk tool only enables medicines whose pack size is
 * ALREADY a structured catalogue field, because its endpoint
 * ({@code POST /medicines/loose-settings/bulk}) deliberately refuses a
 * client-typed number in bulk — a wrong guess mis-prices every loose sale, and
 * bulk has no strip to check it against. For a catalogue with no structured pack
 * sizes (the common case), that tool always shows "Enable for 0".
 *
 * <p>This screen gets the same one-click, do-many-at-once result WITHOUT relaxing
 * that rule: it still calls the single-medicine endpoint
 * ({@code PATCH /medicines/:id/loose-settings}) — one request per medicine, each
 * carrying its own pack size and its own "confirmed" stamp — it just fires that
 * same trusted, per-item call for every row the pharmacist ticks, instead of
 * making them open and submit N separate dialogs. A parsed guess (from the
 * medicine's free-text pack size, e.g. "10s") is shown pre-filled and editable,
 * flagged amber so it's visibly a guess, and the pharmacist can fix it right on
 * this screen before the one footer confirmation covers the whole batch.
 *
 * <p>One bad row does not block the rest — each PATCH is independent, so a typo
 * on one medicine still lets every other one through (an improvement on the
 * true bulk endpoint's all-or-nothing transaction, which fit a narrower job).
 */

export type LooseCandidate = {
  medicineId: string;
  name: string;
  /** Structured value already on record (catalogue or this pharmacy's prior override). Trusted as-is. */
  catalogueUpp: number | null;
  /** Parsed from free-text pack size — a guess the pharmacist must eyeball, never auto-trusted. */
  guessedUpp: number | undefined;
  baseUnitLabel: string;
};

type Row = LooseCandidate & { checked: boolean; value: string };

type MedicineLike = {
  id:           string;
  name:         string;
  unitsPerPack?: number | null;
  packSize?:     string | null;
  baseUnit?:     string | null;
};

/** The candidate shape, with no eligibility opinion — the caller has already
 *  decided this medicine belongs in a loose-setup dialog. Shared by both
 *  {@link candidateFrom} below and the Medicines-page row ✂ button, so "first-time
 *  enable" looks and behaves identically no matter which screen it's launched from. */
export function candidateFromMedicine(medicine: MedicineLike): LooseCandidate {
  const catalogueUpp = medicine.unitsPerPack && medicine.unitsPerPack >= 2 ? medicine.unitsPerPack : null;
  const guessedUpp = catalogueUpp ? undefined : parsePackSize(medicine.packSize ?? null);
  return {
    medicineId:   medicine.id,
    name:         medicine.name,
    catalogueUpp,
    guessedUpp,
    baseUnitLabel: (medicine.baseUnit ?? "").toLowerCase() || "piece",
  };
}

/** Shared with `BatchesTab`'s row-level ✂ button, so a single-row trigger builds
 *  the exact same candidate shape the bulk fetch below would have produced for it. */
export function candidateFrom(medicine: InventoryItem["medicine"]): LooseCandidate | null {
  if (medicine.isActive === false) return null;
  if ((medicine.schedule ?? "").trim().toUpperCase() === "X") return null;
  if (medicine.allowLooseSale) return null;
  return candidateFromMedicine(medicine);
}

export function LooseSetupModal({ only, onClose, onDone }: {
  /** Row-level trigger (the ✂ button on one Inventory row) — skips the fetch entirely. */
  only?: LooseCandidate;
  onClose: () => void;
  /** Count actually enabled, so the caller can refresh its list and toast. */
  onDone: (count: number) => void;
}) {
  const [loading,   setLoading]   = useState(!only);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipped,   setSkipped]   = useState(0);
  const [rows,      setRows]      = useState<Row[]>(
    only ? [{ ...only, checked: true, value: String(only.catalogueUpp ?? only.guessedUpp ?? "") }] : [],
  );
  const [ack,     setAck]     = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (only) return;
    let cancelled = false;
    (async () => {
      try {
        // Every stocked medicine, not the whole catalogue — this is "set up loose
        // selling for what I stock", not a catalogue-wide tool. Paginated because
        // /inventory clamps limit to 100 server-side (InventoryService.list); a flat
        // limit:200 request silently truncated to the first 100 batches, so a pharmacy
        // with more stocked batches than that lost candidates with no error or hint —
        // capped at 20 pages (2000 batches) as a sane ceiling, not a real limit.
        // Cached briefly so a quick close-and-reopen (checking something, then coming
        // right back) doesn't re-fetch it; includeAlertCounts:false skips the 2 COUNT
        // queries this screen never reads (that's the dashboard badge's job).
        const items = await queryClient.fetchQuery({
          queryKey: queryKeys.inventory.looseSetupCandidates(),
          queryFn:  async () => {
            const limit = 100;
            const all: InventoryItem[] = [];
            for (let page = 1; page <= 20; page++) {
              const res = await api.get("/inventory", {
                params: { page, limit, includeAlertCounts: false },
              });
              const batch = (res.data.data.items ?? []) as InventoryItem[];
              all.push(...batch);
              const total = res.data.data.total ?? all.length;
              if (all.length >= total || batch.length < limit) break;
            }
            return all;
          },
          staleTime: 20_000,
        });
        if (cancelled) return;
        const byMedicine = new Map<string, LooseCandidate>();
        let out = 0;
        for (const item of items) {
          if (byMedicine.has(item.medicine.id)) continue;
          const c = candidateFrom(item.medicine);
          if (c) byMedicine.set(item.medicine.id, c);
          else out++;
        }
        setRows([...byMedicine.values()].map((c) => ({
          ...c, checked: c.catalogueUpp != null || c.guessedUpp != null,
          value: String(c.catalogueUpp ?? c.guessedUpp ?? ""),
        })));
        setSkipped(out);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, "Couldn't load your inventory."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [only]);

  function setRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.medicineId === id ? { ...r, ...patch } : r)));
  }

  // "Tablets & Capsules" quick-select — cut-strip selling is mostly tablets/capsules
  // per the pharmacist's own workflow, and only rows with a REAL catalogue units-per-pack
  // (not a parsed guess) are safe to bulk-tick without eyeballing a strip. Purely additive
  // — it only turns rows on, never off, so it can't undo a row someone already unchecked.
  const smartEligible = rows.filter(
    (r) => (r.baseUnitLabel === "tablet" || r.baseUnitLabel === "capsule") && r.catalogueUpp != null,
  );
  function selectTabletsAndCapsules() {
    setRows((prev) => prev.map((r) =>
      (r.baseUnitLabel === "tablet" || r.baseUnitLabel === "capsule") && r.catalogueUpp != null
        ? { ...r, checked: true }
        : r,
    ));
  }

  const selected = rows.filter((r) => r.checked);
  const validSelected = selected.filter((r) => {
    const n = Number(r.value);
    return r.value !== "" && Number.isFinite(n) && n >= 2 && n <= 100000;
  });
  const invalidSelected = selected.length - validSelected.length;
  const canSave = validSelected.length > 0 && ack && !saving;

  async function submit() {
    setSaving(true);
    setError(null);
    let done = 0;
    const failed: string[] = [];
    // Small concurrency window rather than one-at-a-time or all-at-once — fast for
    // a big batch without opening 200 simultaneous connections.
    const queue = [...validSelected];
    async function worker() {
      let row: Row | undefined;
      while ((row = queue.shift())) {
        const num = Number(row.value);
        // Only persist a pharmacy-specific size when it differs from the catalogue's —
        // otherwise a later catalogue correction can't reach this pharmacy, and billing
        // resolves override-else-catalogue anyway. Mirrors the single-medicine dialog.
        const sendUpp = num !== row.catalogueUpp ? num : null;
        try {
          await api.patch(`/medicines/${row.medicineId}/loose-settings`, {
            allowLooseSale: true,
            unitsPerPack:   sendUpp,
            looseByDefault: false,
            confirmed:      true,
          });
          done++;
        } catch (err) {
          failed.push(`${row.name}: ${getErrorMessage(err, "failed")}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, validSelected.length) }, worker));
    setSaving(false);
    if (failed.length > 0) {
      setError(done > 0
        ? `Enabled ${done}, but ${failed.length} failed — ${failed.slice(0, 2).join("; ")}${failed.length > 2 ? "…" : ""}`
        : `Nothing was enabled — ${failed.slice(0, 2).join("; ")}${failed.length > 2 ? "…" : ""}`);
      if (done > 0) onDone(done);
      return;
    }
    onDone(done);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Scissors className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900 leading-tight">
                {only ? "Enable loose selling" : "Set up loose selling"}
              </h2>
              <p className="text-[12px] text-slate-500 leading-tight">
                {only ? only.name : "Medicines you currently stock"}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600 disabled:opacity-40 p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" />Loading your inventory…
            </div>
          ) : loadError ? (
            <p className="text-[13px] text-red-600 text-center py-8">{loadError}</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-slate-500 text-center py-8">
              Nothing eligible — every stocked medicine is either already loose-enabled, Schedule X, or inactive.
            </p>
          ) : (
            <>
              {!only && (
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12px] text-slate-500">
                    Units per pack is pre-filled where we can tell — <span className="text-amber-700 font-semibold">amber</span> ones
                    are a guess from the pack-size text, so check those against a real strip. Fix any number, then confirm once below.
                  </p>
                  {smartEligible.length > 0 && (
                    <button
                      onClick={selectTabletsAndCapsules}
                      title="Tick every tablet/capsule whose pack size is a real catalogue value, not a guess"
                      className="flex-shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3 h-3" />
                      Tablets &amp; Capsules ({smartEligible.length})
                    </button>
                  )}
                </div>
              )}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 w-8" />
                      <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">Medicine</th>
                      <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide w-32">Units / pack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isGuess = r.catalogueUpp == null && r.guessedUpp != null;
                      const num = Number(r.value);
                      const invalid = r.checked && (r.value === "" || !Number.isFinite(num) || num < 2 || num > 100000);
                      return (
                        <tr key={r.medicineId} className={cn(
                          "border-b border-slate-100 last:border-0",
                          r.checked ? (isGuess ? "bg-amber-50/50" : "bg-white") : "bg-slate-50/50 opacity-60",
                        )}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={r.checked}
                              onChange={(e) => setRow(r.medicineId, { checked: e.target.checked })}
                              disabled={!!only}
                              aria-label={`Include ${r.name} in loose selling setup`}
                              className="rounded border-slate-300" />
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{r.name}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <input type="number" min={2} max={100000} value={r.value}
                                onChange={(e) => setRow(r.medicineId, { value: e.target.value })}
                                placeholder="e.g. 10"
                                aria-label={`Units per pack for ${r.name}`}
                                className={cn(
                                  "w-16 border rounded px-2 py-1 text-[12px] text-center focus:outline-none focus:border-blue-400",
                                  invalid ? "border-red-300 bg-red-50" : isGuess ? "border-amber-300 bg-amber-50" : "border-slate-200",
                                )} />
                              <span className="text-slate-400">{r.baseUnitLabel}{Number(r.value) === 1 ? "" : "s"}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {skipped > 0 && (
                <p className="text-[11px] text-slate-400">{skipped} more already loose-enabled, Schedule X, or inactive — left out.</p>
              )}
            </>
          )}
        </div>

        {/* Confirmation, warnings and the Save action live in the fixed footer, not the
            scrolling list above — with 50+ candidates the tick box and button used to
            scroll out of view together, so nothing looked clickable ("Enable" stayed
            grey no matter what you ticked) until you happened to scroll all the way down. */}
        {rows.length > 0 && !loading && !loadError && (
          <div className="flex-shrink-0 border-t border-slate-100 px-6 py-4 space-y-3">
            {invalidSelected > 0 && (
              <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3 flex-shrink-0" />
                {invalidSelected} ticked row{invalidSelected === 1 ? "" : "s"} need{invalidSelected === 1 ? "s" : ""} a valid units-per-pack (2–100000) before it can be included.
              </p>
            )}
            {validSelected.length > 0 && (
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400" />
                <span className="text-[12px] text-slate-600 leading-snug">
                  I've checked {validSelected.length === 1 ? "this pack size" : "these pack sizes"} against a real strip.
                  <span className="block text-[11px] text-slate-400">A wrong number over- or under-charges every loose sale of that medicine.</span>
                </span>
              </label>
            )}
            {error && <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex items-center justify-between">
              <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 font-medium">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSave}
                title={!ack && validSelected.length > 0 ? "Tick the confirmation above first" : undefined}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Enable for {validSelected.length}
              </button>
            </div>
          </div>
        )}
        {(loading || loadError || rows.length === 0) && (
          <div className="flex-shrink-0 border-t border-slate-100 px-6 py-4 flex justify-end">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">
              Close
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
