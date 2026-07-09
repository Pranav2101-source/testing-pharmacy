import { useState, useEffect, useRef } from "react";
import { Plus, ShoppingCart } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { usePurchaseSummary } from "./hooks/usePurchaseSummary";

import type { Tab, PanelType, Supplier, FullSupplier } from "./types";
import { TABS } from "./types";

import { SummaryBar } from "./components/SummaryBar";
import { QuickActionsDropdown } from "./components/QuickActionsDropdown";

import { PurchaseTab }     from "./tabs/PurchaseTab";
import { GateInwardTab }   from "./tabs/GateInwardTab";
import { POTab }           from "./tabs/POTab";
import { ReturnsTab }      from "./tabs/ReturnsTab";
import { DistributorsTab } from "./tabs/DistributorsTab";

import { AutoSuggestPanel }      from "./panels/AutoSuggestPanel";
import { OverdueBillsPanel }     from "./panels/OverdueBillsPanel";
import { PendingApprovalsPanel } from "./panels/PendingApprovalsPanel";
import { QuickPaymentPanel }     from "./panels/QuickPaymentPanel";
import { QuickCreditNotePanel }  from "./panels/QuickCreditNotePanel";

import { CreatePOModal }     from "./modals/CreatePOModal";
import { CreateGRNModal }    from "./modals/CreateGRNModal";
import { CreateReturnModal } from "./modals/CreateReturnModal";
import { SupplierFormModal } from "./modals/SupplierFormModal";

// Each module tab carries its own brand color for the active underline/text —
// gives Purchase/Gate Inward/PO/Returns/Distributors a distinct identity.
const TAB_ACTIVE_CLS: Record<string, string> = {
  emerald: "border-emerald-600 text-emerald-700",
  amber:   "border-amber-500   text-amber-700",
  blue:    "border-blue-600    text-blue-700",
  red:     "border-red-500     text-red-600",
  slate:   "border-slate-600   text-slate-800",
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab,              setTab]         = useState<Tab>("purchase");
  const [mounted,          setMounted]     = useState<Set<Tab>>(() => new Set(["purchase"]));
  const [showCreate,       setShow]        = useState(false);
  const [activePanel,      setPanel]       = useState<PanelType>(null);
  const [reorderMedicine,  setReorderMed]  = useState<{ id: string; name: string; gstRate: number } | undefined>(undefined);
  const prevTab                            = useRef<Tab>("purchase");

  const queryClient = useQueryClient();

  // Suppliers — cached for 5 min; any component can trigger refetch via queryClient
  const { data: supplierData, refetch: refreshSuppliers } = useQuery({
    queryKey: queryKeys.suppliers.all(),
    queryFn:  () => api.get("/suppliers/all").then((r) => (r.data.data ?? []) as Supplier[]),
    staleTime: 5 * 60_000,
  });
  const suppliers = supplierData ?? [];

  const { data: summary } = usePurchaseSummary();
  const pendingApprovals   = summary?.pendingApprovals ?? 0;
  const overdueCount       = summary?.overdueGRNs ?? 0;

  // Deep-link: /dashboard/purchase?create-po=1&medicineId=X&medicine=Y&gstRate=Z
  // Used by the Inventory alerts "Create PO" button to pre-seed a medicine.
  useEffect(() => {
    if (searchParams.get("create-po") !== "1") return;
    const medicineId   = searchParams.get("medicineId")  ?? "";
    const medicineName = searchParams.get("medicine")    ?? "";
    const gstRate      = Number(searchParams.get("gstRate") ?? 0);
    setSearchParams({}, { replace: true }); // clean the URL immediately
    // Open the create-PO modal in all cases. A medicine seed is optional — the
    // Inventory alerts button supplies one; the command palette opens it blank.
    setTab("po");
    setMounted((prev) => (prev.has("po") ? prev : new Set(prev).add("po")));
    if (medicineId && medicineName) {
      setReorderMed({ id: medicineId, name: medicineName, gstRate });
    }
    setShow(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTabChange(next: Tab) {
    if (prevTab.current === "distributors" && next !== "distributors") {
      void refreshSuppliers();
    }
    prevTab.current = next;
    setTab(next);
    setMounted((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }

  function openCreateModal() {
    setShow(true);
  }

  function handleSupplierAdded(s: FullSupplier) {
    // Optimistically update the cache so downstream components see the new
    // supplier immediately, without waiting for the next background refetch.
    queryClient.setQueryData<Supplier[]>(queryKeys.suppliers.all(), (prev = []) => {
      if (prev.some((x) => x.id === s.id)) return prev;
      return [...prev, { id: s.id, name: s.name, phone: s.phone ?? undefined }];
    });
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Page Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}
          >
            <ShoppingCart className="w-3.5 h-3.5 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-[17px] font-bold text-slate-900 tracking-tight">Purchase</h1>
        </div>
        <div className="flex items-center gap-2">
          <QuickActionsDropdown
            tab={tab}
            onTabChange={handleTabChange}
            onPanelOpen={setPanel}
            onOpenCreate={openCreateModal}
            pendingApprovals={pendingApprovals}
            overdueCount={overdueCount}
          />
          <button onClick={openCreateModal}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-[13px] font-semibold h-8 px-4 rounded-lg transition-all shadow-sm shadow-blue-200">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <SummaryBar />

      {/* Tab Bar */}
      <div className="flex items-center border-b border-slate-200 bg-white flex-shrink-0 px-2 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => {
          const Icon     = t.icon;
          const isActive = tab === t.key;
          const cls      = TAB_ACTIVE_CLS[t.color] ?? TAB_ACTIVE_CLS.blue;
          return (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap flex-shrink-0",
                isActive ? cls : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50",
              )}>
              <Icon className="w-3.5 h-3.5" />{t.label}
              {t.key === "po"      && pendingApprovals > 0 && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">{pendingApprovals > 9 ? "9+" : pendingApprovals}</span>
              )}
              {t.key === "purchase" && overdueCount > 0 && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{overdueCount > 9 ? "9+" : overdueCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content — lazy-mount once, then keep alive and hide via CSS.
          Avoids remounting + refetching every panel on every tab switch. */}
      <div className="flex-1 overflow-hidden min-h-0">
        {mounted.has("purchase") && (
          <div className={cn("h-full", tab !== "purchase" && "hidden")}>
            <PurchaseTab suppliers={suppliers} />
          </div>
        )}
        {mounted.has("gate-inward") && (
          <div className={cn("h-full", tab !== "gate-inward" && "hidden")}>
            <GateInwardTab suppliers={suppliers} />
          </div>
        )}
        {mounted.has("po") && (
          <div className={cn("h-full", tab !== "po" && "hidden")}>
            <POTab suppliers={suppliers} />
          </div>
        )}
        {mounted.has("returns") && (
          <div className={cn("h-full", tab !== "returns" && "hidden")}>
            <ReturnsTab suppliers={suppliers} />
          </div>
        )}
        {mounted.has("distributors") && (
          <div className={cn("h-full", tab !== "distributors" && "hidden")}>
            <DistributorsTab onSupplierAdded={handleSupplierAdded} />
          </div>
        )}
      </div>

      {/* Slide-in Panels */}
      <AnimatePresence>
        {activePanel === "auto-suggest"       && <AutoSuggestPanel       onClose={() => setPanel(null)} />}
        {activePanel === "overdue-bills"      && <OverdueBillsPanel      suppliers={suppliers} onClose={() => setPanel(null)} onDone={() => {
          queryClient.setQueryData(queryKeys.purchases.summary(), (old: typeof summary) =>
            old ? { ...old, overduePayments: Math.max(0, old.overduePayments - 1), overdueGRNs: Math.max(0, old.overdueGRNs - 1) } : old);
        }} />}
        {activePanel === "pending-approvals"  && <PendingApprovalsPanel  onClose={() => setPanel(null)} onDone={() => {
          queryClient.setQueryData(queryKeys.purchases.summary(), (old: typeof summary) =>
            old ? { ...old, pendingApprovals: Math.max(0, old.pendingApprovals - 1) } : old);
        }} />}
        {activePanel === "quick-payment"      && <QuickPaymentPanel      suppliers={suppliers} onClose={() => setPanel(null)} />}
        {activePanel === "credit-note"        && <QuickCreditNotePanel   suppliers={suppliers} onClose={() => setPanel(null)} />}
      </AnimatePresence>

      {/* Global "+ New" modal */}
      <AnimatePresence>
        {showCreate && tab === "po"           && <CreatePOModal     suppliers={suppliers} initialMedicine={reorderMedicine} onClose={() => { setShow(false); setReorderMed(undefined); }} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); setReorderMed(undefined); }} />}
        {showCreate && tab === "gate-inward"  && <CreateGRNModal    suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "purchase"     && <CreateGRNModal    suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "returns"      && <CreateReturnModal suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "distributors" && <SupplierFormModal supplier={null} onClose={() => setShow(false)} onSaved={(s) => { handleSupplierAdded(s); setShow(false); }} />}
      </AnimatePresence>
    </div>
  );
}
