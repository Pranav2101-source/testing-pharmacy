import React, { useState } from "react";
import { X, Calendar, Download, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: "csv" | "xlsx", startDate: string, endDate: string) => void;
}

export function ExportReportModal({ isOpen, onClose, onExport }: ExportReportModalProps) {
  // Default to last 30 days
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0]!;
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split("T")[0]!);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [error, setError] = useState<string | null>(null);

  const handleExport = () => {
    const startObj = new Date(startDate);
    const endObj = new Date(endDate);
    
    // Validate bounds
    if (endObj < startObj) {
      setError("End date must be after or equal to start date.");
      return;
    }
    const daysDiff = (endObj.getTime() - startObj.getTime()) / (1000 * 3600 * 24);
    if (daysDiff > 365) {
      setError("Maximum export range is 1 year.");
      return;
    }
    
    setError(null);
    onExport(format, startDate, endDate);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
          />
          
          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden pointer-events-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Export Report</h2>
                  <p className="text-sm text-slate-500">Download platform analytics data.</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {error && (
                  <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-slate-700">Start Date</label>
                    <div className="relative">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          setError(null);
                        }}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                      />
                      <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-slate-700">End Date</label>
                    <div className="relative">
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setError(null);
                        }}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                      />
                      <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">Export Format</label>
                  <div className="flex gap-3">
                    <label className="flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value="csv"
                        checked={format === "csv"}
                        onChange={() => setFormat("csv")}
                        className="peer sr-only"
                      />
                      <div className="px-4 py-3 border-2 border-slate-200 rounded-xl text-center font-semibold text-slate-500 peer-checked:border-emerald-500 peer-checked:text-emerald-700 peer-checked:bg-emerald-50 transition-all">
                        CSV
                      </div>
                    </label>
                    <label className="flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value="xlsx"
                        checked={format === "xlsx"}
                        onChange={() => setFormat("xlsx")}
                        className="peer sr-only"
                      />
                      <div className="px-4 py-3 border-2 border-slate-200 rounded-xl text-center font-semibold text-slate-500 peer-checked:border-blue-500 peer-checked:text-blue-700 peer-checked:bg-blue-50 transition-all">
                        Excel
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/50 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExport}
                  className="px-5 py-2 flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg shadow-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
