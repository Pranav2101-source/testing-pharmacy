import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { TopNav } from "@/components/layout/TopNav";
import { HelpWidget } from "@/components/help/HelpWidget";
import { CommandPalette } from "@/components/CommandPalette";
import { usePrescriptionArrivalWatcher } from "@/hooks/usePrescriptionArrivalWatcher";

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
    </div>
  );
}

export default function DashboardLayout() {
  // App-wide: chime + toast when a clinic pushes a new prescription, on any screen.
  usePrescriptionArrivalWatcher();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-secondary">
      <TopNav />
      <main className="flex-1 overflow-hidden">
        {/* Suspense boundary scoped to the page content — a not-yet-loaded
            route chunk only shows a spinner here, leaving TopNav mounted
            and responsive instead of blanking the whole screen. */}
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <HelpWidget />
      <CommandPalette />
    </div>
  );
}
