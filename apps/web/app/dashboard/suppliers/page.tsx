"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────
interface Supplier {
  id: string;
  name: string;
  gstin?: string;
  dlNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  isActive: boolean;
  createdAt: string;
}

interface SuppliersResponse {
  items: Supplier[];
  total: number;
}

interface FormState {
  name: string;
  gstin: string;
  dlNumber: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
}

const EMPTY_FORM: FormState = {
  name: "", gstin: "", dlNumber: "", phone: "",
  email: "", address: "", city: "", state: "",
};

const PAGE_SIZE = 20;

// ─── Add Supplier Modal ───────────────────────────────────────
function AddSupplierModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Supplier name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/suppliers", {
        name: form.name.trim(),
        gstin: form.gstin.trim() || undefined,
        dlNumber: form.dlNumber.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-brand-600" strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-black text-slate-800">Add Supplier</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Name (required) */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              Supplier Name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="e.g. Medline Distributors"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            />
          </div>

          {/* GSTIN + DL */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">GSTIN</label>
              <input
                value={form.gstin}
                onChange={e => set("gstin", e.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Drug Licence #</label>
              <input
                value={form.dlNumber}
                onChange={e => set("dlNumber", e.target.value)}
                placeholder="MH-MUM-12345"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Phone</label>
              <input
                value={form.phone}
                onChange={e => set("phone", e.target.value)}
                placeholder="9876543210"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set("email", e.target.value)}
                placeholder="orders@supplier.com"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Address</label>
            <input
              value={form.address}
              onChange={e => set("address", e.target.value)}
              placeholder="Street address"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            />
          </div>

          {/* City + State */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">City</label>
              <input
                value={form.city}
                onChange={e => set("city", e.target.value)}
                placeholder="Mumbai"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">State</label>
              <input
                value={form.state}
                onChange={e => set("state", e.target.value)}
                placeholder="Maharashtra"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? "Saving…" : "Add Supplier"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const searchRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (pg: number, q: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: SuppliersResponse }>(
        `/suppliers?page=${pg}&limit=${PAGE_SIZE}`
      );
      let items = res.data.data.items;
      if (q) {
        const lq = q.toLowerCase();
        items = items.filter(s =>
          s.name.toLowerCase().includes(lq) ||
          s.city?.toLowerCase().includes(lq) ||
          s.gstin?.toLowerCase().includes(lq) ||
          s.phone?.includes(lq)
        );
      }
      setSuppliers(items);
      setTotal(res.data.data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => load(page, search), 300);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [page, search, load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">Suppliers</h1>
            <p className="text-sm text-slate-400 mt-0.5">{total} supplier{total !== 1 ? "s" : ""} registered</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white text-sm font-bold shadow-sm transition-all duration-75"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            Add Supplier
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white max-w-sm">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, city, GSTIN…"
            className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-300 hover:text-slate-500 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr] gap-4 px-5 py-3 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            <span>Supplier</span>
            <span>GSTIN</span>
            <span>Drug Licence</span>
            <span>Contact</span>
            <span>Location</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-300">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Building2 className="w-10 h-10 mb-3 opacity-30" strokeWidth={1.4} />
              <p className="text-sm font-semibold">No suppliers found</p>
              <p className="text-xs text-slate-300 mt-1">Add your first supplier to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {suppliers.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/60 transition-colors"
                >
                  {/* Name */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3.5 h-3.5 text-brand-600" strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{s.name}</p>
                      {s.email && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-slate-300" />
                          <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{s.email}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* GSTIN */}
                  <div>
                    {s.gstin ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg">
                        <FileText className="w-3 h-3 text-slate-400" />
                        {s.gstin}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>

                  {/* DL */}
                  <p className="text-sm text-slate-600">{s.dlNumber ?? <span className="text-slate-300">—</span>}</p>

                  {/* Contact */}
                  <div>
                    {s.phone ? (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span className="text-sm text-slate-600">{s.phone}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>

                  {/* Location */}
                  <div>
                    {s.city ? (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span className="text-xs text-slate-600">{s.city}{s.state ? `, ${s.state}` : ""}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
              <p className="text-xs text-slate-400">
                Page {page} of {totalPages} &middot; {total} suppliers
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Supplier Modal */}
      <AnimatePresence>
        {showAdd && (
          <AddSupplierModal
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); load(page, search); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
