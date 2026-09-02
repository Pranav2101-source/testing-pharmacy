import { useState } from "react";
import { X, Printer, Minus, Plus, Scissors } from "lucide-react";

export interface LooseLabelData {
  medicineName: string;
  /** Individual pieces handed over, e.g. 8 for "8 tablets". */
  quantity: number;
  baseUnit?: string | null;
  batchNumber: string;
  expiryDate: string;
}

/** The dispensing pharmacy — printed on the label so a pouch separated from the bill is still traceable. */
export interface LooseLabelPharmacy {
  name: string;
  drugLicense?: string;
  phone?: string;
}

interface Props {
  items: LooseLabelData[];
  pharmacy?: LooseLabelPharmacy;
  onClose: () => void;
}

function formatExpiry(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function unitWord(baseUnit: string | null | undefined, quantity: number): string {
  const plural = quantity === 1 ? "" : "s";
  switch (baseUnit) {
    case "TABLET":  return `tablet${plural}`;
    case "CAPSULE": return `capsule${plural}`;
    case "ML":      return "ml";
    case "GM":      return "gm";
    default:        return `piece${plural}`;
  }
}

/**
 * A small adhesive label for a cut strip — stuck on the pouch or envelope a loose sale is
 * handed over in, since (unlike a whole strip) it carries no printed batch or expiry of its
 * own once it leaves the shelf. Deliberately not the {@link BarcodeLabelModal} shelf label:
 * this isn't stock waiting to be scanned again, so there is no barcode, only the identity a
 * pharmacist or patient would need to read off it later.
 *
 * <p>One label per loose line on the bill, printed together in one job — a bill with two
 * loose medicines gets two labels, not a choice to make about which one.
 */
export function LooseLabelModal({ items, pharmacy, onClose }: Props) {
  const [copies, setCopies] = useState(1);

  function handlePrint() {
    const win = window.open("", "_blank", "width=600,height=400");
    if (!win) return;
    win.document.write(buildLabelHtml(items, copies, pharmacy));
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-800">
            <Scissors className="w-4 h-4 text-amber-500" /> Print Cut-Strip Label{items.length !== 1 ? "s" : ""}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="border-2 border-dashed border-amber-200 rounded-xl p-3 bg-amber-50/40">
                {pharmacy?.name && (
                  <p className="text-[10px] font-semibold text-slate-600 leading-tight mb-0.5">
                    {pharmacy.name}
                    {pharmacy.drugLicense ? ` · DL ${pharmacy.drugLicense}` : ""}
                  </p>
                )}
                <p className="text-[12px] font-bold text-slate-800 leading-tight">{item.medicineName}</p>
                <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
                  {item.quantity} {unitWord(item.baseUnit, item.quantity)}
                </p>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1">
                  <span>Batch: <strong>{item.batchNumber}</strong></span>
                  <span>Exp: <strong>{formatExpiry(item.expiryDate)}</strong></span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-700">Copies of each</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCopies(c => Math.max(1, c - 1))}
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-600">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-10 text-center text-[14px] font-bold text-slate-700">{copies}</span>
              <button onClick={() => setCopies(c => Math.min(10, c + 1))}
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-600">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[12px] font-bold transition-colors">
              <Printer className="w-3.5 h-3.5" /> Print {items.length * copies} label{items.length * copies !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildLabelHtml(items: LooseLabelData[], copies: number, pharmacy?: LooseLabelPharmacy): string {
  const dispensedOn = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const header = pharmacy?.name
    ? `<p class="pharm">${escHtml(pharmacy.name)}${pharmacy.drugLicense ? ` &middot; DL ${escHtml(pharmacy.drugLicense)}` : ""}`
      + `${pharmacy.phone ? ` &middot; ${escHtml(pharmacy.phone)}` : ""}</p>`
    : "";
  const one = (item: LooseLabelData) => `
    <div class="label">
      ${header}
      <p class="tag">✂ Cut strip — not resealed</p>
      <p class="medicine">${escHtml(item.medicineName)}</p>
      <p class="qty">${item.quantity} ${escHtml(unitWord(item.baseUnit, item.quantity))}</p>
      <div class="meta">
        <span>Batch: <b>${escHtml(item.batchNumber)}</b></span>
        <span>Exp: <b>${formatExpiry(item.expiryDate)}</b></span>
      </div>
      <p class="date">Dispensed ${dispensedOn}</p>
    </div>`;

  const labels = items.flatMap((item) => Array.from({ length: copies }, () => one(item))).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Cut-Strip Labels</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #fff; }
  .label {
    display: inline-flex; flex-direction: column; align-items: center; text-align: center;
    width: 2.2in; padding: 5px 8px; border: 1px solid #ccc; border-radius: 4px;
    margin: 4px; page-break-inside: avoid;
  }
  .pharm    { font-size: 7.5px; font-weight: bold; color: #334155; line-height: 1.2; margin-bottom: 2px; }
  .tag      { font-size: 7px; font-weight: bold; color: #b45309; text-transform: uppercase; letter-spacing: 0.03em; }
  .medicine { font-size: 11px; font-weight: bold; line-height: 1.25; margin-top: 2px; }
  .qty      { font-size: 9px; font-weight: bold; color: #b45309; margin-top: 1px; }
  .meta     { display: flex; gap: 8px; font-size: 8px; color: #333; margin-top: 3px; }
  .date     { font-size: 7px; color: #888; margin-top: 2px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>${labels}</body>
</html>`;
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
