import { useState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";

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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab,              setTab]         = useState<Tab>("purchase");
  const [showCreate,       setShow]        = useState(false);
  const [activePanel,      setPanel]       = useState<PanelType>(null);
  const [pendingApprovals, setPending]     = useState(0);
  const [overdueCount,     setOverdue]     = useState(0);
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

  useEffect(() => {
    Promise.all([
      api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 1 } }),
      api.get("/purchases/grn",    { params: { overdue: true, status: "CONFIRMED",  limit: 1 } }),
    ]).then(([poRes, grnRes]) => {
      setPending(poRes.data.data.total  ?? 0);
      setOverdue(grnRes.data.data.total ?? 0);
    }).catch(() => {});
  }, []);

  // Deep-link: /dashboard/purchase?create-po=1&medicineId=X&medicine=Y&gstRate=Z
  // Used by the Inventory alerts "Create PO" button to pre-seed a medicine.
  useEffect(() => {
    if (searchParams.get("create-po") !== "1") return;
    const medicineId   = searchParams.get("medicineId")  ?? "";
    const medicineName = searchParams.get("medicine")    ?? "";
    const gstRate      = Number(searchParams.get("gstRate") ?? 0);
    setSearchParams({}, { replace: true }); // clean the URL immediately
    if (!medicineId || !medicineName) return;
    setTab("po");
    setReorderMed({ id: medicineId, name: medicineName, gstRate });
    setShow(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTabChange(next: Tab) {
    if (prevTab.current === "distributors" && next !== "distributors") {
      void refreshSuppliers();
    }
    prevTab.current = next;
    setTab(next);
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

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Page Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900">Purchase</h1>
          <span className="text-[11px] font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
            {activeTab.label}
          </span>
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
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold h-8 px-4 rounded-lg transition-colors shadow-sm">
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
          return (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap flex-shrink-0",
                isActive ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50",
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

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {tab === "purchase"     && <PurchaseTab      suppliers={suppliers} />}
        {tab === "gate-inward"  && <GateInwardTab    suppliers={suppliers} />}
        {tab === "po"           && <POTab            suppliers={suppliers} />}
        {tab === "returns"      && <ReturnsTab       suppliers={suppliers} />}
        {tab === "distributors" && <DistributorsTab  onSupplierAdded={handleSupplierAdded} />}
      </div>

      {/* Slide-in Panels */}
      <AnimatePresence>
        {activePanel === "auto-suggest"       && <AutoSuggestPanel       onClose={() => setPanel(null)} />}
        {activePanel === "overdue-bills"      && <OverdueBillsPanel      suppliers={suppliers} onClose={() => setPanel(null)} />}
        {activePanel === "pending-approvals"  && <PendingApprovalsPanel  onClose={() => setPanel(null)} onDone={() => { setPending((p) => Math.max(0, p - 1)); }} />}
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
