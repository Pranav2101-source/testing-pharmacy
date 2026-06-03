/**
 * BarcodeInput — works with both USB keyboard-wedge scanners and manual entry.
 *
 * USB scanners type characters very fast and end with Enter. This component
 * detects that pattern: if ≥3 chars arrive within SCAN_TIMEOUT_MS and Enter is
 * pressed, it treats it as a scan event and calls onScan. For manual typing it
 * behaves like a normal search box with a 400ms debounce.
 *
 * Usage:
 *   <BarcodeInput onScan={(code) => lookupBarcode(code)} placeholder="Scan or type barcode…" />
 */

import { useRef, useState, useEffect } from "react";
import { ScanLine, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BarcodeInputProps {
  onScan:       (code: string) => void | Promise<void>;
  placeholder?: string;
  loading?:     boolean;
  className?:   string;
  autoFocus?:   boolean;
}

const SCAN_TIMEOUT_MS = 80; // scanners type faster than this per keystroke

export function BarcodeInput({
  onScan, placeholder = "Scan barcode…", loading, className, autoFocus,
}: BarcodeInputProps) {
  const [value,      setValue]      = useState("");
  const [scanning,   setScanning]   = useState(false);
  const lastKeyTime  = useRef<number>(0);
  const inputRef     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now();
    const gap = now - lastKeyTime.current;
    lastKeyTime.current = now;

    if (e.key === "Enter") {
      const code = value.trim();
      if (code.length >= 3) {
        const isLikelyScanner = gap < SCAN_TIMEOUT_MS;
        if (isLikelyScanner) {
          setScanning(true);
          Promise.resolve(onScan(code)).finally(() => {
            setScanning(false);
            setValue("");
          });
        } else {
          // Manual entry — still trigger on Enter
          onScan(code);
          setValue("");
        }
      }
      e.preventDefault();
    }
  }

  function clear() {
    setValue("");
    inputRef.current?.focus();
  }

  const isActive = scanning || loading;

  return (
    <div className={cn(
      "flex items-center border rounded-lg overflow-hidden h-[36px] transition-all",
      isActive ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300",
      className,
    )}>
      <span className="px-2.5 flex-shrink-0">
        {isActive
          ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          : <ScanLine className="w-4 h-4 text-slate-400" />
        }
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 h-full bg-transparent text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none pr-2"
      />
      {value && (
        <button onClick={clear} className="px-2 text-slate-300 hover:text-slate-500 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
