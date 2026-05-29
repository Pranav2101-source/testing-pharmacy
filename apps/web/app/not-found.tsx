import Link from "next/link";

export default function NotFound() {
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

        {/* 404 */}
        <div className="text-8xl font-black text-slate-200 leading-none mb-4 select-none">404</div>
        <h1 className="text-2xl font-black text-slate-800 mb-2">Page not found</h1>
        <p className="text-sm text-slate-500 leading-relaxed mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors shadow-sm"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/login"
            className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
