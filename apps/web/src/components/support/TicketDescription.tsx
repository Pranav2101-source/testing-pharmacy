import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (val: string) => void;
  error?: string;
  disabled?: boolean;
};

export function TicketDescription({ value, onChange, error, disabled }: Props) {
  const charsRemaining = 2000 - value.length;

  return (
    <div className="flex-1 flex flex-col min-h-[200px]">
      <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
        Description <span className="text-red-500">*</span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Describe the issue, expected behavior, actual behavior, and reproduction steps."
        maxLength={2000}
        className={cn(
          "w-full flex-1 border rounded-xl px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
          error ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
          disabled && "opacity-50 cursor-not-allowed bg-slate-50"
        )}
      />
      <div className="flex items-center justify-between mt-1.5">
        {error ? (
          <p className="text-[12px] text-red-500">{error}</p>
        ) : (
          <p className="text-[11px] text-slate-500">
            Ctrl+V to paste screenshots anywhere
          </p>
        )}
        <span
          className={cn(
            "text-[11px] font-medium",
            charsRemaining < 100 ? "text-orange-500" : "text-slate-400"
          )}
        >
          {charsRemaining.toLocaleString()} characters remaining
        </span>
      </div>
    </div>
  );
}
