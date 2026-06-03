import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <p className="text-8xl font-black text-slate-200">404</p>
        <h1 className="text-2xl font-black text-slate-800 mt-2">Page not found</h1>
        <p className="text-slate-500 mt-2">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
