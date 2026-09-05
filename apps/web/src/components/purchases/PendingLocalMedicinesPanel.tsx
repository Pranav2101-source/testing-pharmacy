import { useEffect, useState } from "react";
import { Sparkles, Check, Loader2, CheckCheck } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";

type Suggestion = {
  medicineId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  similarity: number;
};

type PendingLocalMedicine = {
  id: string;
  name: string;
  manufacturer: string | null;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  hsnCode: string | null;
  gstRate: number;
  createdAt: string;
  suggestions: Suggestion[];
};

/**
 * Local medicines a GRN received (see PharmacyMedicine) that the background matcher
 * found only a fuzzy, similarity-score candidate for — never a confident exact match,
 * which auto-links without any review. A plausible-but-wrong link here is a dispensing
 * error, so it's always a pharmacist's call, same principle as
 * ReviewIngestedItemsPanel's Rx suggestions.
 *
 * Renders nothing when there is nothing to review — a list where problems sit mixed
 * in with everything else is a list where they get missed, but an empty list nobody
 * needs to see is just noise.
 */
export function PendingLocalMedicinesPanel() {
  const toast = useToast();
  const isOwnerOrManager = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");
  const [items, setItems] = useState<PendingLocalMedicine[] | null>(null);
  const [bulkLinking, setBulkLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/purchases/local-medicines/pending")
      .then(({ data }) => { if (!cancelled) setItems(data.data ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (!items || items.length === 0 || !isOwnerOrManager) return null;

  const withSuggestions = items.filter((i) => i.suggestions.length > 0);

  async function linkOne(id: string, medicineId: string) {
    await api.patch(`/purchases/local-medicines/${id}/link`, { medicineId });
    setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
  }

  async function linkAllSuggested() {
    setBulkLinking(true);
    let linked = 0;
    try {
      // Sequential — same reasoning as ReviewIngestedItemsPanel's bulk action: a burst
      // of parallel writes buys nothing on a handful of rows and risks interleaving.
      for (const item of withSuggestions) {
        try {
          await linkOne(item.id, item.suggestions[0]!.medicineId);
          linked++;
        } catch {
          // One failure shouldn't stop the rest — whatever didn't link stays visible.
        }
      }
      if (linked > 0) toast.success(`Linked ${linked} medicine${linked === 1 ? "" : "s"} to your catalogue`);
      if (linked < withSuggestions.length) {
        toast.error(`${withSuggestions.length - linked} could not be linked — try those individually`);
      }
    } finally {
      setBulkLinking(false);
    }
  }

  return (
    <div className="mx-5 mt-3 rounded-lg border border-violet-200 bg-violet-50/70 p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-violet-900">
            {items.length} local medicine{items.length === 1 ? "" : "s"} may match your catalogue
          </p>
          <p className="mt-0.5 text-[12px] text-violet-700">
            Received on a GRN before they were in your catalogue. Confirming a match never changes
            past receipts or sales — it just links this identity going forward.
          </p>
        </div>
        {withSuggestions.length > 1 && (
          <button
            type="button"
            disabled={bulkLinking}
            onClick={linkAllSuggested}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
          >
            {bulkLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Link all suggested ({withSuggestions.length})
          </button>
        )}
      </div>

      <div className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <PendingRow key={item.id} item={item} onLink={linkOne} />
        ))}
      </div>
    </div>
  );
}

function PendingRow({ item, onLink }: {
  item: PendingLocalMedicine;
  onLink: (id: string, medicineId: string) => Promise<void>;
}) {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const top = item.suggestions[0];

  async function link(medicineId: string) {
    setLinking(true);
    try {
      await onLink(item.id, medicineId);
      toast.success(`Linked "${item.name}"`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not link this medicine"));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-violet-100 bg-white px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium text-slate-800">{item.name}</p>
        {top ? (
          <p className="truncate text-[11.5px] text-violet-700">
            Did you mean <span className="font-semibold">{top.name}</span>
            {(top.genericName || top.strength) && (
              <span className="text-violet-500"> ({[top.genericName, top.strength, top.form].filter(Boolean).join(" · ")})</span>
            )}?
          </p>
        ) : (
          <p className="text-[11.5px] text-slate-400">No candidate yet — still staying local.</p>
        )}
      </div>
      {top && (
        <button
          type="button"
          disabled={linking}
          onClick={() => link(top.medicineId)}
          className="shrink-0 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Yes, link it
        </button>
      )}
    </div>
  );
}
