import { Database, Server, Cpu, HardDrive, RefreshCw, LayoutList } from "lucide-react";
import type { SystemHealth } from "../analytics.types";

export function SystemHealthCard({ data }: { data: SystemHealth }) {
  
  const getStatusColor = (status: string) => {
    switch(status) {
      case "HEALTHY": return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";
      case "WARNING": return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
      case "CRITICAL": return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]";
      default: return "bg-slate-400";
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 p-6 mb-8 text-white relative overflow-hidden">
      {/* Decorative background gradients */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />

      <div className="relative z-10 flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">System Health</h2>
          <p className="text-slate-400 text-sm mt-1">Real-time infrastructure probes</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/50">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">All Systems Operational</span>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Database */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-slate-200">PostgreSQL</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(data.database.status)}`} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Latency</p>
              <p className="font-mono text-slate-200">{data.database.latencyMs}ms</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Size</p>
              <p className="font-mono text-slate-200">{data.database.sizeGb}GB</p>
            </div>
          </div>
        </div>

        {/* Redis */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-red-400" />
              <h3 className="font-semibold text-slate-200">Redis Cache</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(data.redis.status)}`} />
          </div>
          <div className="text-sm">
            <p className="text-slate-400 text-xs">Connection</p>
            <p className="font-mono text-emerald-400">Connected</p>
          </div>
        </div>

        {/* Queue */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <LayoutList className="w-5 h-5 text-amber-400" />
              <h3 className="font-semibold text-slate-200">Job Queue</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(data.queue.status)}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Wait</p>
              <p className="font-mono text-slate-200">{data.queue.waiting}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Active</p>
              <p className="font-mono text-blue-400">{data.queue.active}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Fail</p>
              <p className="font-mono text-red-400">{data.queue.failed}</p>
            </div>
          </div>
        </div>

        {/* API */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-400" />
              <h3 className="font-semibold text-slate-200">API Gateway</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor('HEALTHY')}`} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Avg Latency</p>
              <p className="font-mono text-slate-200">{data.api.avgLatencyMs}ms</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Req / Min</p>
              <p className="font-mono text-slate-200">{data.api.requestsPerMin}</p>
            </div>
          </div>
        </div>

        {/* Background Jobs */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-emerald-400" />
              <h3 className="font-semibold text-slate-200">Worker Jobs</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(data.backgroundJobs.failed > 0 ? 'WARNING' : 'HEALTHY')}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Done</p>
              <p className="font-mono text-emerald-400">{data.backgroundJobs.completed}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Fail</p>
              <p className="font-mono text-red-400">{data.backgroundJobs.failed}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Queue</p>
              <p className="font-mono text-slate-200">{data.backgroundJobs.queued}</p>
            </div>
          </div>
        </div>

        {/* Storage */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between hover:bg-slate-800 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold text-slate-200">Object Storage</h3>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor('HEALTHY')}`} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Used Size</p>
              <p className="font-mono text-slate-200">{data.storage.usedMb} MB</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Files</p>
              <p className="font-mono text-slate-200">{data.storage.fileCount.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
