import { useState } from "react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  resolvePrescriptionToCart,
  type BillablePrescription,
  type ItemResolution,
  type ResolvedCart,
} from "@/lib/prescriptionToCart";
import PackRoundingModal, { type RoundedLine } from "@/components/integration/PackRoundingModal";

type PendingRounding = {
  lines: RoundedLine[];
  onCutStrip: () => void;
  onBillAsPack: () => void;
  onCancel: () => void;
};

/**
 * Resolves a prescription into a billing cart and, when any line rounded up to a full pack,
 * pauses for the pharmacist's decision through {@link PackRoundingModal} instead of the old
 * blocking {@code window.confirm(roundUpConfirmMessage(...))} — see that component for what
 * each of its three choices does.
 *
 * <p>Shared by {@code ClinicPrescriptionTriage} and {@code PrescriptionsPage}'s own Bill Now
 * action so a prescription billed from either screen resolves the same cart AND offers the
 * same choice, rather than one screen quietly keeping the old native-dialog behaviour.
 */
export function usePackRoundingDecision() {
  const toast = useToast();
  const [pendingRounding, setPendingRounding] = useState<PendingRounding | null>(null);
  const [cutBusy, setCutBusy] = useState(false);

  /**
   * Turns loose selling ON for every cuttable line, then re-resolves so those lines bill
   * their exact prescribed count instead of a rounded-up pack. One override call per
   * distinct medicine, not per line.
   */
  async function cutStripsAndReresolve(
    rx: BillablePrescription,
    resolutions: Record<string, ItemResolution> | undefined,
    lines: RoundedLine[],
  ): Promise<ResolvedCart> {
    const cuttable = lines.filter(
      (l): l is RoundedLine & { medicineId: string; unitsPerPack: number } =>
        !!l.medicineId && !!l.unitsPerPack && l.unitsPerPack > 1 && (l.schedule ?? "").trim().toUpperCase() !== "X",
    );
    const byMedicineId = new Map(cuttable.map((l) => [l.medicineId, l.unitsPerPack]));

    for (const [medicineId, unitsPerPack] of byMedicineId) {
      // confirmed: true — the modal showed this exact pack size and asked the pharmacist to
      // check it against a real strip before this call is ever made; see MedicineService's
      // own "trustedPackSize" check, which confirmed:true satisfies unconditionally.
      await api.patch(`/medicines/${medicineId}/loose-settings`, {
        allowLooseSale: true, unitsPerPack, looseByDefault: false, confirmed: true,
      });
    }
    return resolvePrescriptionToCart(rx, resolutions);
  }

  function confirmRounding(
    rx: BillablePrescription,
    resolutions: Record<string, ItemResolution> | undefined,
    initial: ResolvedCart,
  ): Promise<ResolvedCart | null> {
    return new Promise((resolve) => {
      setPendingRounding({
        lines: initial.roundedToPack,
        async onCutStrip() {
          setCutBusy(true);
          try {
            const reresolved = await cutStripsAndReresolve(rx, resolutions, initial.roundedToPack);
            setCutBusy(false);
            setPendingRounding(null);
            resolve(reresolved);
          } catch (err) {
            setCutBusy(false);
            // Left open deliberately: a failed override (e.g. a concurrent pack-size change)
            // still leaves "Bill as full pack" and "Cancel" available on the same modal.
            toast.error(getErrorMessage(err, "Could not enable loose selling — try \"Bill as full pack\" instead"));
          }
        },
        onBillAsPack() {
          setPendingRounding(null);
          resolve(initial);
        },
        onCancel() {
          setPendingRounding(null);
          resolve(null);
        },
      });
    });
  }

  /**
   * Resolves {@code rx} into a cart, pausing for the pharmacist's decision when any line
   * needs one. Null means the pharmacist cancelled — callers must treat that as "do nothing",
   * not as an empty cart (which is reported through {@link ResolvedCart.failures} instead and
   * is the caller's own concern to check).
   */
  async function resolveWithRoundingDecision(
    rx: BillablePrescription,
    resolutions?: Record<string, ItemResolution>,
  ): Promise<ResolvedCart | null> {
    const resolved = await resolvePrescriptionToCart(rx, resolutions);
    if (resolved.roundedToPack.length === 0) return resolved;
    return confirmRounding(rx, resolutions, resolved);
  }

  const roundingModal = pendingRounding && (
    <PackRoundingModal
      lines={pendingRounding.lines}
      busy={cutBusy}
      onCutStrip={pendingRounding.onCutStrip}
      onBillAsPack={pendingRounding.onBillAsPack}
      onCancel={pendingRounding.onCancel}
    />
  );

  return { resolveWithRoundingDecision, roundingModal };
}
