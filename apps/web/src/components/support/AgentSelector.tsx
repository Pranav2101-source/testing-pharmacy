import { useQuery } from "@tanstack/react-query";
import { ChevronDown, UserCircle2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Agent = {
  id: string;
  user: { id: string; name: string; email: string };
};

type Props = {
  assignmentType: "UNASSIGNED" | "ROUND_ROBIN" | "MANUAL";
  agentId: string;
  onChange: (type: "UNASSIGNED" | "ROUND_ROBIN" | "MANUAL", agentId: string) => void;
  disabled?: boolean;
};

export function AgentSelector({ assignmentType, agentId, onChange, disabled }: Props) {
  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["support-agents"],
    queryFn: async () => {
      const res = await api.get<{ data: Agent[] }>("/support/agents");
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div>
      <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
        Assign Agent <span className="text-[11px] font-normal text-slate-400">(Optional)</span>
      </label>
      <div className="relative">
        <select
          value={assignmentType === "MANUAL" ? agentId : assignmentType}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "UNASSIGNED" || val === "ROUND_ROBIN") {
              onChange(val, "");
            } else {
              onChange("MANUAL", val);
            }
          }}
          disabled={disabled || isLoading}
          className={cn(
            "w-full appearance-none border border-slate-200 rounded-xl pl-10 pr-8 py-2.5 text-[14px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
            assignmentType === "UNASSIGNED" && "text-slate-500",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <option value="UNASSIGNED">Unassigned</option>
          <option value="ROUND_ROBIN">Round Robin (Auto Assign)</option>
          <optgroup label="Select Agent">
            {agents.map((a) => (
              <option key={a.id} value={a.id} className="text-slate-800">
                {a.user.name}
              </option>
            ))}
          </optgroup>
        </select>
        <UserCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}
