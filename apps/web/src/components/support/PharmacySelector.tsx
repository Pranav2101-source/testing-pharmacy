import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Store } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Pharmacy = { id: string; name: string };

type Props = {
  value: string;
  onChange: (val: string) => void;
  error?: string;
  disabled?: boolean;
};

export function PharmacySelector({ value, onChange, error, disabled }: Props) {
  const { data: pharmacies = [], isLoading } = useQuery<Pharmacy[]>({
    queryKey: ["admin-pharmacies"],
    queryFn: async () => {
      const res = await api.get<{ data: Pharmacy[] }>("/support/pharmacies");
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000, // 5 mins
  });

  return (
    <div>
      <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
        Pharmacy <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isLoading}
          className={cn(
            "w-full appearance-none border rounded-xl pl-10 pr-8 py-2.5 text-[14px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
            error ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
            !value && "text-slate-400",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <option value="" disabled>
            {isLoading ? "Loading pharmacies..." : "Select a pharmacy"}
          </option>
          {pharmacies.map((p) => (
            <option key={p.id} value={p.id} className="text-slate-800">
              {p.name}
            </option>
          ))}
        </select>
        <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
      {error && <p className="text-[12px] text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}
