import { useState, useRef } from "react";
import { FileSpreadsheet, Download, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRN_CSV_TEMPLATE, PO_CSV_TEMPLATE, RETURN_CSV_TEMPLATE, downloadTemplate } from "../utils";

export function ImportPanel({ type, onImport, onClose }: {
  type:      "grn" | "po" | "return";
  onImport:  (raw: string) => void;
  onClose:   () => void;
}) {
  const [text,    setText]    = useState("");
  const [dragging,setDrag]    = useState(false);
  const fileRef               = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => setText((e.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const template  = type === "grn" ? GRN_CSV_TEMPLATE : type === "return" ? RETURN_CSV_TEMPLATE : PO_CSV_TEMPLATE;
  const filename  = type === "grn" ? "grn_import_template.csv" : type === "return" ? "return_import_template.csv" : "po_import_template.csv";
  const rowCount  = text.trim().split("\n").filter(Boolean).length - 1;
  const hasData   = rowCount > 0;

  return (
    <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <FileSpreadsheet className="w-4 h-4 text-blue-600" />Import from CSV / Excel / Google Sheets
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => downloadTemplate(filename, template)}
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 bg-white hover:bg-blue-50 rounded-md px-2.5 py-1.5 transition-colors">
            <Download className="w-3 h-3" />Download Template
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Drop zone / file picker */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
          dragging ? "border-blue-400 bg-blue-100/50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/30",
        )}>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
        <FileSpreadsheet className="w-6 h-6 text-slate-400 mx-auto mb-1" />
        <p className="text-[12px] font-semibold text-slate-600">Drop .csv file here or click to browse</p>
        <p className="text-[11px] text-slate-400 mt-0.5">For Excel / Google Sheets: File → Download as CSV, then import here</p>
      </div>

      {/* Paste area */}
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
          Or paste directly from Excel / Google Sheets (Ctrl+C the cells, then paste below):
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            type === "return"
              ? "medicineName\tbatchNumber\texpiryDate\treturnQty\tpurchaseRate\nParacetamol 500mg\tBATCH001\t2025-12-31\t10\t4.50"
              : type === "po"
              ? "medicineName\tbatchNumber\texpiryDate\tquantity\tpurchaseRate\tmrp\tgstRate\nParacetamol 500mg\tBATCH001\t2027-06-30\t100\t4.50\t8.00\t12"
              : "medicineName\tbatchNumber\texpiryDate\treceivedQty\tfreeQty\tpurchaseRate\tmrp\tdiscount\tgstRate\nParacetamol 500mg\tBATCH001\t2027-06-30\t100\t5\t4.50\t8.00\t0\t12"
          }
          rows={5}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white placeholder-slate-300"
        />
      </div>

      {hasData && (
        <button type="button" onClick={() => onImport(text)}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
          <Check className="w-4 h-4" />Import {rowCount} row{rowCount !== 1 ? "s" : ""} into form
        </button>
      )}
    </div>
  );
}
