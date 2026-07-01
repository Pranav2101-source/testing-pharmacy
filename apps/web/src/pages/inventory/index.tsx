import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Layers, BookOpen, Bell, AlertTriangle, ClipboardList, Package2 } from "lucide-react";
import { StockAuditContent } from "@/pages/dashboard/StockAuditPage";
import { TabBtn } from "./components/shared";
import { BatchesTab } from "./tabs/BatchesTab";
import { LedgerTab } from "./tabs/LedgerTab";
import { AlertsTab } from "./tabs/AlertsTab";
import { VALID_TABS } from "./types";
import type { PageTab, AlertCounts } from "./types";

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw     = searchParams.get("tab") as PageTab | null;
  const pageTab: PageTab = VALID_TABS.includes(raw as PageTab) ? (raw as PageTab) : "batches";

  const [alertCounts, setAlertCounts] = useState<AlertCounts>({ expiry: 0, lowStock: 0 });

  // Stable callback — BatchesTab and AlertsTab both call this whenever they
  // receive fresh data, so the header badge is always up-to-date regardless of
  // which tab was active when the page loaded.
  const handleCountsLoaded = useCallback((c: AlertCounts) => setAlertCounts(c), []);

  const totalAlerts = alertCounts.expiry + alertCounts.lowStock;
  const go = (t: PageTab) => setSearchParams(t === "batches" ? {} : { tab: t });

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Package2 className="w-4 h-4 text-blue-600" />
        </div>
        <h1 className="text-[18px] font-bold text-slate-900 leading-none">Inventory</h1>
        {totalAlerts > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" />
            {totalAlerts} alert{totalAlerts !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Unified tab bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-2 border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto">
        <TabBtn
          active={pageTab === "batches"} onClick={() => go("batches")}
          icon={Layers} label="Batches" color="blue"
        />
        <TabBtn
          active={pageTab === "ledger"} onClick={() => go("ledger")}
          icon={BookOpen} label="Stock Ledger" color="purple"
        />
        <TabBtn
          active={pageTab === "alerts"} onClick={() => go("alerts")}
          icon={Bell} label="Alerts" color="red" badge={totalAlerts}
        />
        <div className="h-5 w-px bg-slate-200 mx-1 flex-shrink-0" />
        <TabBtn
          active={pageTab === "audit"} onClick={() => go("audit")}
          icon={ClipboardList} label="Stock Audit" color="orange"
        />
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-h-0">
        {pageTab === "batches" && <BatchesTab onCountsLoaded={handleCountsLoaded} />}
        {pageTab === "ledger"  && <LedgerTab />}
        {pageTab === "alerts"  && <AlertsTab onCountsLoaded={handleCountsLoaded} />}
        {pageTab === "audit"   && (
          <div className="h-full overflow-auto">
            <StockAuditContent />
          </div>
        )}
      </div>
    </div>
  );
}
