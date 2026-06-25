import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope, Plus, Search, Pencil, Power, X, Loader2, Phone, Mail, Hash } from "lucide-react";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

interface Doctor {
  id: string; pharmacyId: string;
  name: string; registrationNo: string | null; specialty: string | null;
  clinic: string | null; phone: string | null; email: string | null; address: string | null;
  isActive: boolean; createdAt: string;
}

interface DoctorForm {
  name: string; registrationNo: string; specialty: string;
  clinic: string; phone: string; email: string; address: string;
}

const BLANK: DoctorForm = { name: "", registrationNo: "", specialty: "", clinic: "", phone: "", email: "", address: "" };

// ── Modal ─────────────────────────────────────────────────────────
function DoctorModal({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const [form, setForm] = useState<DoctorForm>(
    doctor
      ? { name: doctor.name, registrationNo: doctor.registrationNo ?? "", specialty: doctor.specialty ?? "",
          clinic: doctor.clinic ?? "", phone: doctor.phone ?? "", email: doctor.email ?? "", address: doctor.address ?? "" }
      : BLANK
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  function set(k: keyof DoctorForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (doctor) {
        await api.patch(`/doctors/${doctor.id}`, form);
        toast.success("Doctor updated");
      } else {
        await api.post("/doctors", form);
        toast.success("Doctor added");
      }
      qc.invalidateQueries({ queryKey: ["doctors"] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to save doctor");
    } finally { setSaving(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        {/* Blue header matching CustomerModal */}
        <div className="bg-blue-700 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-blue-200 text-[11px] font-semibold tracking-wide uppercase">Doctor Master</p>
            <h2 className="text-white text-[18px] font-bold leading-snug">
              {doctor ? doctor.name : "Add New Doctor"}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-1.5 bg-white text-blue-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {doctor ? "Save Changes" : "Add Doctor"}
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)]">
          {/* Row 1: Name + Reg No */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input value={form.name} onChange={set("name")} required autoFocus={!doctor}
                placeholder="Dr. Full Name"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Registration No.
              </label>
              <input value={form.registrationNo} onChange={set("registrationNo")}
                placeholder="MCI / State reg. no."
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
          </div>

          {/* Row 2: Specialty + Clinic */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Specialty
              </label>
              <input value={form.specialty} onChange={set("specialty")}
                placeholder="e.g. General Physician"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Clinic / Hospital
              </label>
              <input value={form.clinic} onChange={set("clinic")}
                placeholder="Clinic or hospital name"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
          </div>

          {/* Row 3: Phone + Email */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">Phone</label>
              <input value={form.phone} onChange={set("phone")} type="tel"
                placeholder="Contact number"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">Email</label>
              <input value={form.email} onChange={set("email")} type="email"
                placeholder="Email address"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
            </div>
          </div>

          {/* Row 4: Address */}
          <div>
            <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">Address</label>
            <input value={form.address} onChange={set("address")}
              placeholder="Clinic / home address"
              className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors" />
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function DoctorsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);
  const [modal, setModal]   = useState<Doctor | null | "new">(null);
  const toast = useToast();
  const qc = useQueryClient();

  const params = new URLSearchParams({ page: String(page), limit: "20", ...(search ? { search } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ["doctors", page, search],
    queryFn:  () => api.get<{ success: boolean; data: Doctor[]; total: number; pages: number }>(`/doctors?${params}`).then(r => r.data),
  });

  async function toggleActive(doctor: Doctor) {
    const path = doctor.isActive ? "deactivate" : "reactivate";
    try {
      await api.patch(`/doctors/${doctor.id}/${path}`);
      toast.success(doctor.isActive ? "Doctor deactivated" : "Doctor reactivated");
      qc.invalidateQueries({ queryKey: ["doctors"] });
    } catch { toast.error("Failed to update doctor"); }
  }

  const doctors = data?.data ?? [];
  const pages   = data?.pages ?? 1;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-blue-600" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-slate-800">Doctor Master</h1>
            <p className="text-[12px] text-slate-500">{data?.total ?? "—"} doctors on record</p>
          </div>
        </div>
        <button
          onClick={() => setModal("new")}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Doctor
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name, specialty…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 bg-white shadow-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-300" />
          </div>
        ) : doctors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Stethoscope className="w-10 h-10 text-slate-200 mb-3" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">{search ? "No doctors match your search" : "No doctors yet"}</p>
            {!search && <button onClick={() => setModal("new")} className="mt-3 text-[12px] text-blue-600 font-semibold hover:underline">Add your first doctor</button>}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Specialty</th>
                <th className="px-4 py-3 text-left">Reg. No.</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map(d => (
                <tr key={d.id} className="border-t border-slate-50 hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-800">{d.name}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-600">{d.specialty ?? <span className="text-slate-300">—</span>}</p>
                    {d.clinic && <p className="text-[11px] text-slate-400 mt-0.5">{d.clinic}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {d.registrationNo
                      ? <span className="flex items-center gap-1 text-slate-500"><Hash className="w-3 h-3" />{d.registrationNo}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {d.phone && <div className="flex items-center gap-1 text-slate-500"><Phone className="w-3 h-3" />{d.phone}</div>}
                      {d.email && <div className="flex items-center gap-1 text-slate-400 text-[11px]"><Mail className="w-3 h-3" />{d.email}</div>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", d.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                      {d.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModal(d)} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleActive(d)} title={d.isActive ? "Deactivate" : "Reactivate"}
                        className={cn("p-1.5 rounded-lg transition-colors", d.isActive ? "hover:bg-red-50 text-slate-400 hover:text-red-500" : "hover:bg-emerald-50 text-slate-400 hover:text-emerald-600")}>
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Previous
          </button>
          <span className="text-[12px] text-slate-500">Page {page} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Next
          </button>
        </div>
      )}

      {modal && (
        <DoctorModal
          doctor={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
