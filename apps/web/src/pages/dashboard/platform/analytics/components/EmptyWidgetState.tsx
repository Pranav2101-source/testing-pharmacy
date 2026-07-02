import { BarChart3 } from "lucide-react";

interface EmptyWidgetStateProps {
  message?: string;
}

export function EmptyWidgetState({ message = "No data available for this range." }: EmptyWidgetStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center text-slate-400">
      <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
        <BarChart3 className="w-6 h-6 text-slate-300" />
      </div>
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
