"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { X, Tag, Loader2, Check } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { IconGridPicker } from "@/components/IconGridPicker";
import { PACKAGING_UNITS, PRODUCT_CATEGORIES } from "@/lib/product-taxonomy";
import { syncProductClassification } from "@/lib/product-cache";

// A small modal that lets owners/managers set a product's category & packaging
// from anywhere they meet the product (inventory, add-stock, POS) — the same
// "universal product fact" mutation the API already allows for barcodes, so no
// platform-admin needed. Both fields are optional; saving is one PATCH.

export type ClassifyTarget = {
  id: string;
  name: string;
  category?: string | null;
  unit?: string | null;
};

export function ClassifyModal({
  target,
  onClose,
  onSaved,
}: {
  target: ClassifyTarget;
  onClose: () => void;
  onSaved?: (updated: { category: string | null; unit: string | null }) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState(target.category ?? "");
  const [unit, setUnit] = useState(target.unit ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = (category ?? "") !== (target.category ?? "") || (unit ?? "") !== (target.unit ?? "");

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.patch(`/medicines/${target.id}/classification`, {
        category: category.trim() || null,
        unit: unit.trim() || null,
      });
      const updated = { category: data.data.category ?? null, unit: data.data.unit ?? null };
      // Reflect the change instantly on every surface + refetch to reconcile,
      // regardless of which screen opened this modal.
      syncProductClassification(queryClient, target.id, updated);
      toast.success(`Updated “${target.name}”`);
      onSaved?.(updated);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save — please try again."));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-blue-50/70 to-white">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-blue-200">
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Classify product</p>
            <p className="font-bold text-slate-900 text-[15px] truncate">{target.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors">
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Category / Type</label>
            <IconGridPicker value={category} onChange={setCategory} options={PRODUCT_CATEGORIES} title="Product Category" placeholder="Select category" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Packaging</label>
            <IconGridPicker value={unit} onChange={setUnit} options={PACKAGING_UNITS} title="Packaging Type" placeholder="Select packaging" />
          </div>
          <p className="text-[11px] text-slate-400">Optional — helps everyone tell this product apart at a glance in billing and inventory.</p>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
