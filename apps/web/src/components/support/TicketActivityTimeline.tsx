import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Ticket, UserPlus, ShieldAlert, CheckCircle2, XCircle, 
  RefreshCcw, MessageSquare, Paperclip, Activity
} from "lucide-react";

export type ActivityType = 
  | "CREATED" 
  | "ASSIGNED" 
  | "PRIORITY_CHANGED" 
  | "SLA_CHANGED" 
  | "STATUS_CHANGED" 
  | "NOTE_ADDED" 
  | "REPLY" 
  | "ATTACHMENT" 
  | "CLOSED" 
  | "REOPENED";

export interface TicketActivity {
  id: string;
  type: ActivityType;
  actor: { id: string; name: string; role: string };
  createdAt: string;
  details?: string;
  metadata?: Record<string, any>;
}

function getIconForActivity(type: ActivityType) {
  switch (type) {
    case "CREATED": return <Ticket className="w-4 h-4 text-emerald-500" />;
    case "ASSIGNED": return <UserPlus className="w-4 h-4 text-blue-500" />;
    case "PRIORITY_CHANGED": return <ShieldAlert className="w-4 h-4 text-amber-500" />;
    case "SLA_CHANGED": return <Activity className="w-4 h-4 text-purple-500" />;
    case "STATUS_CHANGED": return <RefreshCcw className="w-4 h-4 text-indigo-500" />;
    case "NOTE_ADDED": return <MessageSquare className="w-4 h-4 text-yellow-600" />;
    case "REPLY": return <MessageSquare className="w-4 h-4 text-slate-500" />;
    case "ATTACHMENT": return <Paperclip className="w-4 h-4 text-slate-500" />;
    case "CLOSED": return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case "REOPENED": return <XCircle className="w-4 h-4 text-rose-500" />;
    default: return <Activity className="w-4 h-4 text-slate-400" />;
  }
}

function getIconBg(type: ActivityType) {
  switch (type) {
    case "CREATED": return "bg-emerald-100 border-emerald-200";
    case "ASSIGNED": return "bg-blue-100 border-blue-200";
    case "PRIORITY_CHANGED": return "bg-amber-100 border-amber-200";
    case "SLA_CHANGED": return "bg-purple-100 border-purple-200";
    case "STATUS_CHANGED": return "bg-indigo-100 border-indigo-200";
    case "NOTE_ADDED": return "bg-yellow-100 border-yellow-200";
    case "CLOSED": return "bg-emerald-100 border-emerald-200";
    case "REOPENED": return "bg-rose-100 border-rose-200";
    default: return "bg-slate-100 border-slate-200";
  }
}

function ActivityItem({ activity, isLast }: { activity: TicketActivity; isLast: boolean }) {
  return (
    <div className="relative flex gap-4">
      {/* Line connecting icons */}
      {!isLast && (
        <div className="absolute left-4 top-8 bottom-[-16px] w-0.5 bg-slate-200" />
      )}
      
      <div className={cn(
        "relative z-10 w-8 h-8 rounded-full border shadow-sm flex items-center justify-center flex-shrink-0 mt-0.5",
        getIconBg(activity.type)
      )}>
        {getIconForActivity(activity.type)}
      </div>
      
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-slate-800">
            {activity.actor.name}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">
            {new Date(activity.createdAt).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
            })}
          </span>
        </div>
        
        <div className="mt-1">
          {activity.type === "NOTE_ADDED" ? (
            <div className="mt-2 bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-[13px] text-slate-700">
              <span className="font-semibold text-[11px] uppercase tracking-wider text-yellow-600 block mb-1">Internal Note</span>
              {activity.details}
            </div>
          ) : (
            <p className="text-[13px] text-slate-600">
              {activity.details}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  activities: TicketActivity[];
}

export function TicketActivityTimeline({ activities }: Props) {
  if (activities.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-slate-500">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="px-1 py-2">
      {activities.map((act, i) => (
        <ActivityItem key={act.id} activity={act} isLast={i === activities.length - 1} />
      ))}
    </div>
  );
}
