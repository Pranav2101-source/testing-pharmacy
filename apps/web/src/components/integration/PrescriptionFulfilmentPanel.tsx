import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { useBillingStore, type CartItem } from "@/components/billing/useBillingStore";

type RxItem = {
  id: string;
  medicineName: string;
  medicineId: string | null;
  quantity: number;
  dispensedQty: number;
};

type RxRecord = {
  id: string;
  externalTenantId: string | null;
  items: RxItem[];
};

/**
 * Says which cart line fulfils which prescribed line, for the cases the server cannot work
 * out on its own.
 *
 * <p>Dispensing is normally attributed by matching the sold medicine to a prescribed one,
 * which needs no help and gets none here. The exception is a SUBSTITUTION: the pharmacist
 * hands over a different product, so nothing links the two by medicine, and without saying
 * so explicitly the prescribed line stays unfulfilled — the prescription never closes and
 * the clinic is told the patient collected nothing.
 *
 * <p>Only shown for a prescription that came from a clinic. A counter-written one reports
 * to nobody, so the attribution buys nothing and the panel would be noise at a busy till.
 */
export default function PrescriptionFulfilmentPanel({ prescriptionId }: { prescriptionId: string }) {
  const items = useBillingStore((s) => s.items);
  const linkToPrescriptionItem = useBillingStore((s) => s.linkToPrescriptionItem);

  const { data: rx } = useQuery<RxRecord | null>({
    queryKey: ["prescription-fulfilment", prescriptionId],
    queryFn: async () => {
      const { data } = await api.get(`/prescriptions/${prescriptionId}`);
      return data.data;
    },
    enabled: !!prescriptionId,
  });

  if (!rx || !rx.externalTenantId) return null;

  // Only lines that are not already settled: a line the patient has fully collected needs
  // no attribution, and listing it invites someone to re-attribute a closed line.
  const open = rx.items.filter((i) => i.dispensedQty < i.quantity);
  if (open.length === 0 || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Prescribed lines
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Set this only when you have handed over a <strong>different product</strong> from the one
        prescribed. Anything you dispensed as written is matched automatically.
      </p>

      <div className="mt-2.5 space-y-1.5">
        {open.map((line) => {
          const linked = items.find((i) => i.prescriptionItemId === line.id);
          return (
            <div key={line.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {line.medicineName}
                <span className="text-slate-400"> · {line.quantity - line.dispensedQty} left</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              <select
                value={linked?.inventoryId ?? ""}
                onChange={(e) => {
                  const chosen = e.target.value;
                  // Clear the previous holder explicitly. Selecting "as prescribed" passes an
                  // empty inventoryId, which matches no cart line, so without this the old
                  // attribution would simply survive the change.
                  if (linked && linked.inventoryId !== chosen) {
                    linkToPrescriptionItem(linked.inventoryId, null);
                  }
                  if (chosen) {
                    linkToPrescriptionItem(chosen, line.id);
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-brand-400 focus:outline-none"
              >
                <option value="">Dispensed as prescribed</option>
                {items.map((i: CartItem) => (
                  <option key={i.inventoryId} value={i.inventoryId}>
                    {i.medicineName}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
