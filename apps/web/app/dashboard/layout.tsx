"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopNav } from "@/components/layout/TopNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/");
    }
  }, [router]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-secondary">
      <TopNav />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
