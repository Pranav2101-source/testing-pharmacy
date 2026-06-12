import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { X, Printer, Minus, Plus } from "lucide-react";

export interface BarcodeLabelData {
  medicineName:  string;
  genericName?:  string | null;
  batchNumber:   string;
  expiryDate:    string;
  mrp:           number;
  barcode?:      string | null;
}

interface Props {
  item: BarcodeLabelData;
  onClose: () => void;
}

function formatExpiry(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function BarcodeLabelModal({ item, onClose }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const printRef    = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(1);
  const [error,  setError]  = useState(false);

  // The barcode value: prefer the catalogue barcode, fall back to batch number
  const barcodeValue = item.barcode ?? item.batchNumber;

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      JsBarcode(canvasRef.current, barcodeValue, {
        format:      "CODE128",
        lineColor:   "#000",
        width:       1.6,
        height:      40,
        displayValue: true,
        fontSize:    10,
        margin:      4,
        background:  "#fff",
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, [barcodeValue]);

  function handlePrint() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const barcodeDataUrl = canvas.toDataURL("image/png");
    const labelHtml      = buildLabelHtml(item, barcodeDataUrl, copies);

    const win = window.open("", "_blank", "width=600,height=400");
    if (!win) return;
    win.document.write(labelHtml);
    win.document.close();
    win.focus();
    // Give the browser time to load the image before printing
    setTimeout(() => { win.print(); win.close(); }, 400);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-800">Print Barcode Label</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Label preview */}
        <div className="p-6 space-y-5">
          <div ref={printRef} className="border-2 border-dashed border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col items-center gap-2">
            <p className="text-[13px] font-bold text-slate-800 text-center leading-tight">{item.medicineName}</p>
            {item.genericName && (
              <p className="text-[10px] text-slate-500 text-center">{item.genericName}</p>
            )}
            {error ? (
              <p className="text-[11px] text-red-500 py-2">Cannot render barcode for: {barcodeValue}</p>
            ) : (
              <canvas ref={canvasRef} className="max-w-full" />
            )}
            <div className="flex items-center gap-4 text-[11px] text-slate-600 mt-1">
              <span>Batch: <strong>{item.batchNumber}</strong></span>
              <span>Exp: <strong>{formatExpiry(item.expiryDate)}</strong></span>
              <span>MRP: <strong>₹{Number(item.mrp).toFixed(2)}</strong></span>
            </div>
          </div>

          {/* Copies selector */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-700">Copies</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCopies(c => Math.max(1, c - 1))}
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-600">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-10 text-center text-[14px] font-bold text-slate-700">{copies}</span>
              <button onClick={() => setCopies(c => Math.min(50, c + 1))}
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-600">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button onClick={handlePrint} disabled={error}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
              <Printer className="w-3.5 h-3.5" /> Print {copies} label{copies !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Builds a self-contained HTML document with N label copies ─────────────────
function buildLabelHtml(item: BarcodeLabelData, barcodeDataUrl: string, copies: number): string {
  const expiry = formatExpiry(item.expiryDate);
  const mrp    = Number(item.mrp).toFixed(2);
  const single = `
    <div class="label">
      <p class="medicine">${escHtml(item.medicineName)}</p>
      ${item.genericName ? `<p class="generic">${escHtml(item.genericName)}</p>` : ""}
      <img src="${barcodeDataUrl}" alt="barcode" />
      <div class="meta">
        <span>Batch: <b>${escHtml(item.batchNumber)}</b></span>
        <span>Exp: <b>${expiry}</b></span>
        <span>MRP: <b>₹${mrp}</b></span>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode Labels</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #fff; }
  .label {
    display: inline-flex; flex-direction: column; align-items: center;
    width: 2.5in; padding: 4px 6px; border: 1px solid #ccc;
    margin: 4px; page-break-inside: avoid;
  }
  .medicine { font-size: 10px; font-weight: bold; text-align: center; line-height: 1.2; }
  .generic  { font-size: 8px; color: #666; text-align: center; margin-top: 1px; }
  img       { max-width: 100%; height: auto; margin: 3px 0; }
  .meta     { display: flex; gap: 6px; font-size: 8px; color: #333; flex-wrap: wrap; justify-content: center; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>${single.repeat(copies)}</body>
</html>`;
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
