import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Stethoscope, KeyRound, Copy, Check, Loader2, ShieldCheck, Unplug,
  AlertTriangle, RefreshCw, Link2, Eye, EyeOff,
} from "lucide-react";
import { format } from "date-fns";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * The pharmacy's half of the checkup.care clinic handshake — the mirror of the
 * clinic's own "connect a pharmacy" screen.
 *
 * Three fields have to end up in the clinic's form (pharmacy ID, pharmacy URL,
 * connection key) and one has to come back the other way (the clinic's callback
 * URL, which carries the clinic's connection id in its path). This panel is
 * arranged in exactly that order, because that is the order a pharmacist does it in.
 */

type ConnectionStatus = {
  pharmacyId:             string;
  pharmacyName:           string;
  pharmacyUrl:            string;
  clinicName:             string | null;
  callbackUrl:            string | null;
  keyIssued:              boolean;
  connectedAt:            string | null;
  keyUpdatedAt:           string | null;
  prescriptionsReceived:  number;
  lastPrescriptionAt:     string | null;
  pendingDispenseUpdates: number;
  failedDispenseUpdates:  number;
};

const QUERY_KEY = ["emr-connection"];

export function ClinicConnectionPanel() {
  const toast       = useToast();
  const queryClient = useQueryClient();
  const role        = getStoredUser()?.role ?? "";
  const canManage   = role === "OWNER" || role === "MANAGER";

  const [clinicName,  setClinicName]  = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [issuedKey,   setIssuedKey]   = useState<string | null>(null);
  const [showKey,     setShowKey]     = useState(false);
  const [copied,      setCopied]      = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn:  async () => {
      const { data } = await api.get<{ data: ConnectionStatus }>("/pharmacy/emr-connection");
      return data.data;
    },
    staleTime: 30_000,
  });
  const status = statusQuery.data;

  // Seed the form from the saved connection, without clobbering an in-progress edit.
  useEffect(() => {
    if (!status) return;
    setClinicName((current)  => (current ? current : status.clinicName  ?? ""));
    setCallbackUrl((current) => (current ? current : status.callbackUrl ?? ""));
  }, [status]);

  const saveClinic = useMutation({
    mutationFn: async () => {
      const { data } = await api.put<{ data: ConnectionStatus }>("/pharmacy/emr-connection", {
        clinicName:  clinicName.trim(),
        callbackUrl: callbackUrl.trim(),
      });
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Clinic details saved");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Could not save the clinic details")),
  });

  const generateKey = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ data: { key: string; generatedAt: string } }>(
        "/pharmacy/emr-connection/key",
      );
      return data.data;
    },
    onSuccess: (data) => {
      setIssuedKey(data.key);
      setShowKey(true);
      setCopied(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Connection key generated");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Could not generate a connection key")),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<{ data: ConnectionStatus }>("/pharmacy/emr-connection");
      return data.data;
    },
    onSuccess: () => {
      setIssuedKey(null);
      setClinicName("");
      setCallbackUrl("");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Clinic disconnected");
    },
    onError: (err) => toast.error(getErrorMessage(err, "Could not disconnect the clinic")),
  });

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied((current) => (current === label ? null : current)), 2000);
  };

  if (statusQuery.isLoading) {
    return <div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />;
  }

  if (statusQuery.isError || !status) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
        <Unplug className="w-5 h-5 text-slate-400 mx-auto" />
        <p className="mt-2 text-sm font-bold text-slate-700">Clinic connection is unavailable</p>
        <p className="mt-1 text-xs text-slate-500">
          Billing and prescriptions are unaffected. Try loading the connection again.
        </p>
        <button
          onClick={() => statusQuery.refetch()}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const connected = status.keyIssued && !!status.callbackUrl;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="p-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center flex-shrink-0">
            <Stethoscope className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-slate-800">checkup.care Clinic (EMR)</p>
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
                connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
              )}>
                {connected
                  ? <><Check className="w-2.5 h-2.5" /> Connected</>
                  : <><Link2 className="w-2.5 h-2.5" /> Not connected</>}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
              Prescriptions written at the clinic arrive in your Prescriptions screen, and what you
              actually dispense is sent back to the patient's chart automatically.
            </p>
          </div>
        </div>
        {connected && canManage && (
          <button
            onClick={() => {
              if (window.confirm("Disconnect this clinic? Incoming prescriptions and dispensing updates both stop, and the connection key is destroyed.")) {
                disconnect.mutate();
              }
            }}
            disabled={disconnect.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 disabled:opacity-50"
          >
            {disconnect.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unplug className="w-3 h-3" />}
            Disconnect
          </button>
        )}
      </div>

      {/* Live counters — only meaningful once something has actually flowed */}
      {(status.prescriptionsReceived > 0 || status.failedDispenseUpdates > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100">
          <Stat label="Prescriptions received" value={status.prescriptionsReceived} />
          <Stat
            label="Last received"
            value={status.lastPrescriptionAt ? format(new Date(status.lastPrescriptionAt), "dd MMM, h:mm a") : "—"}
          />
          <Stat label="Updates queued" value={status.pendingDispenseUpdates} />
          <Stat label="Updates failed" value={status.failedDispenseUpdates} tone={status.failedDispenseUpdates > 0 ? "warn" : undefined} />
        </div>
      )}

      <div className="p-5 space-y-6">
        {/* Step 1 — what the clinic needs from this pharmacy */}
        <section>
          <StepHeading n={1} title="Give these to your clinic" />
          <p className="text-xs text-slate-500 mb-3">
            In checkup.care, open <span className="font-semibold">Settings → Connected pharmacy</span> and paste these in.
          </p>
          <div className="space-y-2">
            <CopyRow label="Pharmacy ID"   value={status.pharmacyId}   copied={copied === "id"}   onCopy={() => copy("id", status.pharmacyId)} />
            <CopyRow label="Display name"  value={status.pharmacyName} copied={copied === "name"} onCopy={() => copy("name", status.pharmacyName)} />
            <CopyRow label="Pharmacy URL"  value={status.pharmacyUrl}  copied={copied === "url"}  onCopy={() => copy("url", status.pharmacyUrl)} />
          </div>
        </section>

        {/* Step 2 — the shared key */}
        <section>
          <StepHeading n={2} title="Generate the connection key" />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                {status.keyIssued
                  ? "A key is already in place. Generating a new one immediately stops the old one working — use it if the key was ever seen by someone it shouldn't have been."
                  : "This key signs every message between the two products. It is shown once and stored encrypted; nobody can read it back afterwards."}
              </p>
              {canManage && (
                <button
                  onClick={() => generateKey.mutate()}
                  disabled={generateKey.isPending}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  {generateKey.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  {status.keyIssued ? "Generate a new key" : "Generate key"}
                </button>
              )}
            </div>

            <AnimatePresence>
              {issuedKey && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 rounded-xl bg-white border border-brand-200 p-3"
                >
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Shown once — copy it now
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-slate-800 break-all bg-slate-50 px-2 py-1.5 rounded">
                      {showKey ? issuedKey : "•".repeat(Math.min(issuedKey.length, 43))}
                    </code>
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "Hide key" : "Show key"}
                      className="shrink-0 p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => copy("key", issuedKey)}
                      className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600"
                    >
                      {copied === "key" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copied === "key" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!issuedKey && status.keyIssued && (
              <p className="mt-3 text-[11px] text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                Key in place{status.keyUpdatedAt ? ` since ${format(new Date(status.keyUpdatedAt), "dd MMM yyyy, h:mm a")}` : ""}.
              </p>
            )}
          </div>
        </section>

        {/* Step 3 — what this pharmacy needs from the clinic */}
        <section>
          <StepHeading n={3} title="Point dispensing updates back at the clinic" />
          <p className="text-xs text-slate-500 mb-3">
            Copy the callback address the clinic shows after it saves the connection. It ends in
            <span className="font-mono"> /api/v1/integrations/pharmacy/callback/&lt;id&gt;</span>.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); saveClinic.mutate(); }}
          >
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Clinic name
              <input
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                disabled={!canManage}
                placeholder="City Health Clinic"
                className="mt-1.5 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50"
              />
            </label>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Clinic callback URL
              <input
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                disabled={!canManage}
                placeholder="https://clinic.checkup.care/api/v1/integrations/pharmacy/callback/…"
                className="mt-1.5 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50"
              />
            </label>
            {canManage && (
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saveClinic.isPending || !clinicName.trim() || !callbackUrl.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold disabled:opacity-40"
                >
                  {saveClinic.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save clinic details
                </button>
              </div>
            )}
          </form>
        </section>

        {!canManage && (
          <p className="text-[11px] text-slate-400">
            Only an owner or manager can change this connection.
          </p>
        )}
      </div>
    </motion.div>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="w-5 h-5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black flex items-center justify-center">
        {n}
      </span>
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
    </div>
  );
}

function CopyRow({ label, value, copied, onCopy }: {
  label: string; value: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0">{label}</span>
      <code className="flex-1 min-w-0 truncate text-xs font-mono text-slate-700">{value || "—"}</code>
      <button
        onClick={onCopy}
        disabled={!value}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-600 disabled:opacity-40"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={cn("text-sm font-black mt-0.5", tone === "warn" ? "text-amber-600" : "text-slate-800")}>
        {value}
      </p>
    </div>
  );
}
