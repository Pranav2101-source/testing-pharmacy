import { useState } from "react";
import { Search, Link2, AlertTriangle, Check, CheckCheck, Sparkles, Loader2 } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { useMedicineCatalogSearch } from "@/lib/useMedicineCatalogSearch";

/** Shared by a single row's "Yes, link it" and the panel's "Link all suggested" bulk action. */
async function linkMedicine(prescriptionId: string, itemId: string, medicineId: string) {
  await api.patch(`/prescriptions/${prescriptionId}/items/${itemId}/medicine`, { medicineId });
}

type MedicineSuggestion = {
  medicineId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  similarity: number;
};

type UnmatchedItem = {
  id: string;
  medicineName: string;
  quantity: number;
  dosage: string | null;
  suggestions: MedicineSuggestion[];
};

/**
 * Resolves the prescription lines the clinic's medicine names did not match.
 *
 * <p>These arrive unlinked on purpose. The ingest matcher will not guess: the medicine
 * catalogue is shared by every pharmacy on the platform, and booking a sale against a
 * plausible-but-wrong product is a dispensing error rather than a data-quality one. So an
 * unrecognised name is handed to a human instead.
 *
 * <p>It matters that this gets done, not just that it is visible. An unlinked line cannot be
 * attributed to anything sold, so it never accrues a dispensed quantity, the prescription
 * can never close, and the clinic is never told the patient collected it.
 *
 * <p>Shows ONLY the lines that need attention. A list where the problems sit mixed in with
 * twenty fine ones is a list where the problems get missed.
 */
export default function ReviewIngestedItemsPanel({
  prescriptionId,
  items,
  onLinked,
}: {
  prescriptionId: string;
  items: {
    id: string; medicineName: string; medicineId: string | null; quantity: number; dosage: string | null;
    suggestions?: MedicineSuggestion[];
  }[];
  onLinked: () => void;
}) {
  const toast = useToast();
  const [bulkLinking, setBulkLinking] = useState(false);

  const unmatched: UnmatchedItem[] = items
    .filter((i) => i.medicineId === null)
    .map((i) => ({
      id: i.id, medicineName: i.medicineName, quantity: i.quantity, dosage: i.dosage,
      suggestions: i.suggestions ?? [],
    }));

  if (unmatched.length === 0) return null;

  const withSuggestions = unmatched.filter((i) => i.suggestions.length > 0);

  async function linkAllSuggested() {
    setBulkLinking(true);
    let linked = 0;
    try {
      // Sequential, not Promise.all: these PATCH the same prescription row one line at a
      // time — a burst of parallel writes to the same record risks the backend seeing them
      // out of order for no real time saving on a handful of lines.
      for (const item of withSuggestions) {
        try {
          await linkMedicine(prescriptionId, item.id, item.suggestions[0]!.medicineId);
          linked++;
        } catch {
          // One failure shouldn't stop the rest — report the count actually linked below,
          // and whatever didn't link stays visible in the list for a manual retry.
        }
      }
      if (linked > 0) {
        toast.success(`Linked ${linked} medicine${linked === 1 ? "" : "s"}`);
        onLinked();
      }
      if (linked < withSuggestions.length) {
        toast.error(`${withSuggestions.length - linked} could not be linked — try those individually`);
      }
    } finally {
      setBulkLinking(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">
            {unmatched.length} line{unmatched.length === 1 ? "" : "s"} need
            {unmatched.length === 1 ? "s" : ""} a medicine chosen
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            The clinic sent these names and we could not match them to your catalogue with
            confidence. Pick the right product — the prescription cannot be completed until
            each one is linked.
          </p>
        </div>
        {withSuggestions.length > 1 && (
          <button
            type="button"
            disabled={bulkLinking}
            onClick={linkAllSuggested}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
          >
            {bulkLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Link all suggested ({withSuggestions.length})
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {unmatched.map((item) => (
          <UnmatchedRow
            key={item.id}
            prescriptionId={prescriptionId}
            item={item}
            onLinked={onLinked}
          />
        ))}
      </div>
    </div>
  );
}

function UnmatchedRow({
  prescriptionId,
  item,
  onLinked,
}: {
  prescriptionId: string;
  item: UnmatchedItem;
  onLinked: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Seeded with the doctor's wording: it is usually close, and retyping it is the tax this
  // panel exists to remove.
  const [term, setTerm] = useState(item.medicineName);
  const [linking, setLinking] = useState<string | null>(null);

  const { data: hits = [], isFetching, isError } = useMedicineCatalogSearch(term, 8, open);

  async function link(medicineId: string) {
    setLinking(medicineId);
    try {
      await linkMedicine(prescriptionId, item.id, medicineId);
      toast.success(`Linked "${item.medicineName}"`);
      setOpen(false);
      onLinked();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not link this medicine"));
    } finally {
      setLinking(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{item.medicineName}</p>
          <p className="text-xs text-slate-500">
            Qty {item.quantity}
            {item.dosage && ` · ${item.dosage}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
        >
          <Link2 className="h-3.5 w-3.5" />
          {open ? "Cancel" : "Choose medicine"}
        </button>
      </div>

      {/* The catalogue's own best guess, one click to accept — never applied on its own.
          Hidden once the full search is open: two ways to pick at once is just noise. */}
      {!open && item.suggestions.length > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1 truncate text-xs text-violet-800">
            Did you mean <span className="font-semibold">{item.suggestions[0]!.name}</span>
            {(item.suggestions[0]!.genericName || item.suggestions[0]!.strength) && (
              <span className="text-violet-600">
                {" "}({[item.suggestions[0]!.genericName, item.suggestions[0]!.strength, item.suggestions[0]!.form]
                  .filter(Boolean).join(" · ")})
              </span>
            )}
            ?
          </span>
          <button
            type="button"
            disabled={linking !== null}
            onClick={() => link(item.suggestions[0]!.medicineId)}
            className="shrink-0 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {linking === item.suggestions[0]!.medicineId
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Check className="h-3 w-3" />}
            Yes, link it
          </button>
        </div>
      )}

      {open && (
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search your catalogue…"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div className="mt-2 max-h-48 overflow-y-auto">
            {term.trim().length < 2 ? (
              <p className="px-1 py-2 text-xs text-slate-500">Type at least two letters.</p>
            ) : isFetching ? (
              <p className="px-1 py-2 text-xs text-slate-500">Searching…</p>
            ) : isError ? (
              <p className="px-1 py-2 text-xs text-red-600">Couldn't search — check your connection and try again.</p>
            ) : hits.length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-500">
                Nothing matched. If you do not stock this medicine, leave the line unlinked and
                cancel the prescription once it has been filled elsewhere.
              </p>
            ) : (
              <ul className="space-y-1">
                {hits.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={linking !== null}
                      onClick={() => link(m.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-60",
                        linking === m.id && "bg-brand-50",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-slate-800">{m.name}</span>
                        {(m.genericName || m.strength) && (
                          <span className="block truncate text-xs text-slate-500">
                            {[m.genericName, m.strength, m.form].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                      {linking === m.id && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
