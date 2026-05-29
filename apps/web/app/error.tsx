"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#0c1f5c,#1a3080)" }}
          >
            <span className="text-white font-black text-xl leading-none">+</span>
          </div>
          <div className="leading-none">
            <p className="font-extrabold text-slate-800 text-base">Checkup</p>
            <p className="text-slate-400 text-[10px] font-semibold tracking-widest uppercase">Pharmacy</p>
          </div>
        </div>

        <div className="text-6xl mb-4 select-none">⚠️</div>
        <h1 className="text-2xl font-black text-slate-800 mb-2">Something went wrong</h1>
        <p className="text-sm text-slate-500 leading-relaxed mb-8">
          An unexpected error occurred. Our team has been notified.
          {error.digest && (
            <span className="block mt-1 text-xs font-mono text-slate-400">
              Error ID: {error.digest}
            </span>
          )}
        </p>

        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors shadow-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
