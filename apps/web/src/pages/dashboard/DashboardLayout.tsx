import { Outlet } from "react-router-dom";
import { TopNav } from "@/components/layout/TopNav";

export default function DashboardLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-secondary">
      <TopNav />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
