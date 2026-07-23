import { useState, useRef } from "react";
import { FileSpreadsheet, Download, X, Check, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRN_CSV_TEMPLATE, PO_CSV_TEMPLATE, RETURN_CSV_TEMPLATE, downloadTemplate } from "../utils";
import { extractPdfTableText, isPdfFile } from "../utils/pdfExtract";
import { MAX_UPLOAD_MB } from "../utils";

export function ImportPanel({ type, onImport, onClose, onPdfSelected, allowPdf }: {
  type:      "grn" | "po" | "return";
  onImport:  (raw: string) => void;
  onClose:   () => void;
  /** Called whenever a PDF is dropped/picked, so the parent can upload it and
   * attach it as a reference document — independent of whether text extraction
   * below finds a usable item table. Only relevant when `allowPdf` is set. */
  onPdfSelected?: (file: File) => void;
  /** Enables PDF drop/upload support. Off by default (e.g. Return import). */
  allowPdf?: boolean;
}) {
  const [text,      setText]      = useState("");
  const [dragging,  setDrag]      = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [pdfBusy,   setPdfBusy]   = useState(false);
  const fileRef                   = useRef<HTMLInputElement>(null);

  function loadText(raw: string) {
    // Guard: binary content (ZIP / Excel) starts with "PK" magic bytes
    // eslint-disable-next-line no-control-regex
    if (raw.startsWith("PK") || /[\x00-\x08\x0E-\x1F]/.test(raw.slice(0, 200))) {
      setFileError("This looks like a binary Excel file. Use the file picker above to upload it — or copy cells inside Excel first, then paste.");
      return;
    }
    setFileError(null);
    setText(raw);
  }

  function readFile(file: File) {
    setFileError(null);
    setPdfNotice(null);

    // Reject oversized files instantly, client-side — the server caps uploads at
    // MAX_UPLOAD_MB and would reset the connection on a larger one, so without this
    // the user waits for a doomed multi-MB upload (and the PDF parse) only to get a
    // silent failure. Fail fast with the size and the limit.
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setFileError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum is ${MAX_UPLOAD_MB} MB. Try a smaller file, or split it.`);
      return;
    }

    if (allowPdf && isPdfFile(file)) {
      onPdfSelected?.(file);
      setPdfBusy(true);
      extractPdfTableText(file)
        .then((tsv) => {
          if (tsv) {
            loadText(tsv);
          } else {
            setPdfNotice("Couldn't find a readable item table in this PDF — it may be a scanned image. We've attached it for reference; please enter items manually below.");
          }
        })
        .catch(() => {
          setPdfNotice("Couldn't find a readable item table in this PDF — it may be a scanned image. We've attached it for reference; please enter items manually below.");
        })
        .finally(() => setPdfBusy(false));
      return;
    }

    const isExcel =
      /\.(xlsx|xls|ods)$/i.test(file.name) ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    const reader = new FileReader();
    if (isExcel) {
      // SheetJS is loaded on demand — keeps it out of the main Purchase bundle
      // since most visits never touch the Excel-import flow.
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const XLSX = await import("@e965/xlsx");
          const wb   = XLSX.read(data, { type: "array", cellDates: true });
          const ws   = wb.Sheets[wb.SheetNames[0]!];
          const tsv  = XLSX.utils.sheet_to_csv(ws!, { FS: "\t" });
          setFileError(null);
          setText(tsv);
        } catch {
          setFileError("Could not read the Excel file. Make sure it is a valid .xlsx/.xls file and try again.");
        }
      };
      reader.onerror = () => setFileError("Failed to read the file.");
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => loadText((e.target?.result as string) ?? "");
      reader.onerror = () => setFileError("Failed to read the file.");
      reader.readAsText(file);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
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
        onDrop={handleFileDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
          dragging ? "border-blue-400 bg-blue-100/50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/30",
        )}>
        <input ref={fileRef} type="file" accept={allowPdf ? ".xlsx,.xls,.ods,.csv,.tsv,.txt,.pdf" : ".xlsx,.xls,.ods,.csv,.tsv,.txt"} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
        {pdfBusy ? (
          <Loader2 className="w-6 h-6 text-blue-400 mx-auto mb-1 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-6 h-6 text-slate-400 mx-auto mb-1" />
        )}
        <p className="text-[12px] font-semibold text-slate-600">
          {pdfBusy ? "Reading PDF…" : allowPdf ? "Drop Excel, CSV, or PDF file here, or click to browse" : "Drop Excel or CSV file here, or click to browse"}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{allowPdf ? "Supports .xlsx, .xls, .ods, .csv, .pdf" : "Supports .xlsx, .xls, .ods, .csv"}</p>
      </div>

      {/* Paste area */}
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
          Or paste directly from Excel / Google Sheets (Ctrl+C the cells, then paste below):
        </p>
        <textarea
          value={text}
          onChange={(e) => loadText(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
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

      {fileError && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-700">{fileError}</p>
        </div>
      )}

      {pdfNotice && (
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
          <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-blue-700">{pdfNotice}</p>
        </div>
      )}

      {hasData && !fileError && (
        <button type="button" onClick={() => onImport(text)}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
          <Check className="w-4 h-4" />Import {rowCount} row{rowCount !== 1 ? "s" : ""} into form
        </button>
      )}
    </div>
  );
}
