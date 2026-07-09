import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  X, ScanLine, Loader2, Search, Pill, CheckCircle2, AlertCircle, Info, ArrowLeft,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { BarcodeInput } from "@/components/BarcodeInput";
import type { MedicineSearchResult } from "@pharmacy/types";

// ─── Barcode Mapping ────────────────────────────────────────────────────────
// A rapid, barcode-first tool for populating medicine barcodes so POS/GRN scans
// resolve. Flow: scan a product → if the code is new, search & pick the medicine
// it belongs to → save. Already-mapped codes are recognised and skipped. Built
// for bulk work: the scanner keeps focus and a running count is shown.

export function BarcodeMappingModal({ onClose, onToast }: {
  onClose: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [checking,    setChecking]    = useState(false);
  const [already,     setAlready]     = useState<{ code: string; name: string } | null>(null);
  const [lastMapped,  setLastMapped]  = useState<{ code: string; name: string } | null>(null);
  const [mappedCount, setMappedCount] = useState(0);
  const [error,       setError]       = useState<string | null>(null);

  // Medicine search (only active while assigning a pending code)
  const [query,     setQuery]     = useState("");
  const [debounced, setDebounced] = useState("");
  const [saving,    setSaving]    = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { if (pendingCode) setTimeout(() => searchRef.current?.focus(), 40); }, [pendingCode]);

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ["medicine-search", debounced],
    queryFn:  () =>
      api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q: debounced, limit: 8 },
      }).then((r) => r.data.data),
    enabled:   debounced.length > 0 && !!pendingCode,
    staleTime: 60_000,
  });

  // Scan handler — decides whether this code is new (assign) or already mapped.
  async function onScan(code: string) {
    const trimmed = code.trim();
    if (trimmed.length < 3) return;
    setError(null); setAlready(null); setLastMapped(null); setChecking(true);
    try {
      const res = await api.get<{ data: { id: string; name: string } }>(
        `/medicines/barcode/${encodeURIComponent(trimmed)}`,
      );
      // 200 → this barcode is already assigned; surface it and move on.
      setAlready({ code: trimmed, name: res.data.data.name });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setPendingCode(trimmed);   // new code — prompt to assign a medicine
        setQuery(""); setDebounced("");
      } else {
        setError(`Couldn't check barcode "${trimmed}". Check your connection and try again.`);
      }
    } finally {
      setChecking(false);
    }
  }

  // Assign the pending barcode to the chosen medicine.
  async function assignTo(m: MedicineSearchResult) {
    if (!pendingCode) return;
    setSaving(true); setError(null);
    try {
      await api.patch(`/medicines/${m.id}/barcode`, { barcode: pendingCode });
      setMappedCount((c) => c + 1);
      setLastMapped({ code: pendingCode, name: m.name });
      onToast(`Barcode ${pendingCode} → ${m.name}`, "success");
      setPendingCode(null);
      setQuery(""); setDebounced("");
    } catch (err) {
      // 409 = barcode raced onto another medicine; server message is specific.
      setError(getErrorMessage(err, "Couldn't save the barcode. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  function cancelPending() {
    setPendingCode(null); setQuery(""); setDebounced(""); setError(null);
    setAlready(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <ScanLine className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Map Barcodes</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">Scan a product, then link it to a medicine</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mappedCount > 0 && (
              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                {mappedCount} mapped
              </span>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {!pendingCode ? (
            <>
              {/* ── Scanner ─────────────────────────────────────────── */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Scan or type a barcode
                </label>
                <BarcodeInput onScan={onScan} loading={checking} autoFocus placeholder="Scan or type barcode…" />
              </div>

              {/* Feedback: last mapped */}
              {lastMapped && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[13px] text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>Mapped <span className="font-mono font-semibold">{lastMapped.code}</span> → <span className="font-semibold">{lastMapped.name}</span>. Scan the next product.</span>
                </div>
              )}

              {/* Feedback: already mapped */}
              {already && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-[13px] text-blue-700">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <span><span className="font-mono font-semibold">{already.code}</span> is already mapped to <span className="font-semibold">{already.name}</span>.</span>
                </div>
              )}

              {!lastMapped && !already && (
                <p className="text-[12px] text-slate-400 text-center py-2">
                  Ready. Point your scanner at a product barcode — the input stays focused for the next scan.
                </p>
              )}
            </>
          ) : (
            <>
              {/* ── Assign pending code ─────────────────────────────── */}
              <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5">
                <ScanLine className="w-4 h-4 text-violet-500 flex-shrink-0" />
                <span className="text-[13px] text-violet-800">
                  New barcode <span className="font-mono font-bold">{pendingCode}</span> — which medicine is this?
                </span>
              </div>

              <div className="relative">
                <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400">
                  <span className="pl-3 text-slate-400">
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </span>
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search medicine by name or generic…"
                    className="flex-1 px-2.5 py-2.5 text-[14px] bg-transparent focus:outline-none"
                  />
                </div>
                {debounced.length > 0 && (results.length > 0 || !searching) && (
                  <ul className="mt-1 border border-slate-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-50">
                    {results.length === 0 ? (
                      <li className="px-3 py-4 text-center text-[12px] text-slate-400">
                        No medicine matches “{debounced}”. It must exist in the catalogue first.
                      </li>
                    ) : results.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => assignTo(m)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-blue-50/60 disabled:opacity-50"
                        >
                          <Pill className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-slate-800 truncate">{m.name}</span>
                            <span className="block text-[11px] text-slate-400 truncate">
                              {[m.genericName, m.manufacturer].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button type="button" onClick={cancelPending}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-slate-600">
                <ArrowLeft className="w-3.5 h-3.5" /> Cancel — scan a different barcode
              </button>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-white">
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
