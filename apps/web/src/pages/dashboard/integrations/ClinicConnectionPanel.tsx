import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Stethoscope, KeyRound, Copy, Check, Loader2, ShieldCheck, Unplug,
  AlertTriangle, RefreshCw, Link2, Eye, EyeOff, Wand2, Sparkles, Clock,
} from "lucide-react";
import { format } from "date-fns";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * The pharmacy's half of the checkup.care clinic handshake.
 *
 * Two ways in, both ending at the same connected state:
 *
 *  - PAIRING (the default). Generate a code, read it to whoever runs the clinic's
 *    checkup.care account along with this pharmacy's URL, and wait. The clinic
 *    enters both on its side; the moment it does, this screen notices on its own —
 *    no refresh, no second step, no callback URL to transcribe by hand. This is the
 *    whole reason pairing exists: it collapses three copy-pasted fields (id, key,
 *    then the clinic's own callback address typed back in) into two, and removes
 *    the one direction a typo used to be undiscoverable in.
 *
 *  - MANUAL, behind a fallback toggle. The original three-step flow, kept exactly
 *    as it worked before pairing existed — a pharmacy id, a key, and a callback
 *    URL entered by hand. Still the only path for a clinic that authenticates on
 *    the native per-request HMAC surface directly, where the pharmacy id travels
 *    in a header on every request and genuinely has to be known up front.
 *
 * "Connected" reads true for either path — the badge and stats below don't care
 * which door was used, only that one was.
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
  paired:                 boolean;
  pairedAt:               string | null;
};

const QUERY_KEY = ["emr-connection"];
const POLL_MS = 2500;

export function ClinicConnectionPanel({ pollIntervalMs = POLL_MS }: { pollIntervalMs?: number } = {}) {
  const toast       = useToast();
  const queryClient = useQueryClient();
  const role        = getStoredUser()?.role ?? "";
  const canManage   = role === "OWNER" || role === "MANAGER";

  const [clinicName,  setClinicName]  = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [issuedKey,   setIssuedKey]   = useState<string | null>(null);
  const [showKey,     setShowKey]     = useState(false);
  const [copied,      setCopied]      = useState<string | null>(null);

  // Which door is showing while disconnected, and whether we're actively waiting
  // on the clinic to redeem a code it was just given. waitingSince is a plain
  // timestamp rather than a boolean so the elapsed indicator has something to
  // count from, and it doubles as the poll's on/off switch below.
  const [entryMode,    setEntryMode]    = useState<"pairing" | "manual">("pairing");
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [justPaired,   setJustPaired]   = useState(false);

  const statusQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn:  async () => {
      const { data } = await api.get<{ data: ConnectionStatus }>("/pharmacy/emr-connection");
      return data.data;
    },
    staleTime: 30_000,
    // Only while a code is outstanding and we're watching for the clinic to use
    // it — a connected or genuinely idle screen has nothing to poll for.
    // pollIntervalMs defaults to POLL_MS in production; the prop exists purely so
    // this can be tested with real timers instead of a fixed 2.5s wall-clock wait.
    refetchInterval: waitingSince ? pollIntervalMs : false,
  });
  const status = statusQuery.data;

  // The moment the clinic redeems the code, celebrate once and stop polling.
  // Keyed off status.paired specifically (not "connected" generally) so a
  // pharmacy that was already connected manually and happens to re-fetch mid-poll
  // can't accidentally replay this.
  //
  // Deliberately two effects, not one. This one only DETECTS the transition and
  // flips state; a single combined effect that also armed the celebration's own
  // dismissal timer would self-cancel it — setting waitingSince to null here
  // changes this effect's own dependency array, so React would re-run it on the
  // very next render, and the cleanup from that re-run cancels the timer before
  // it ever fires. Splitting the "detect" and "expire" concerns into effects
  // keyed on different state avoids one effect's cleanup undoing its own work.
  useEffect(() => {
    if (waitingSince && status?.paired) {
      setWaitingSince(null);
      setJustPaired(true);
      toast.success(
        status.clinicName ? `${status.clinicName} is connected` : "Your clinic is connected",
      );
    }
  }, [status?.paired, status?.clinicName, waitingSince, toast]);

  // The celebration's own lifecycle, independent of whatever triggered it — see
  // above for why this can't live in the same effect as the detection.
  useEffect(() => {
    if (!justPaired) return undefined;
    const timer = setTimeout(() => setJustPaired(false), 2400);
    return () => clearTimeout(timer);
  }, [justPaired]);

  // Seed the manual form from the saved connection, without clobbering an in-progress edit.
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
      if (entryMode === "pairing") {
        setWaitingSince(Date.now());
        toast.success("Pairing code generated");
      } else {
        toast.success("Connection key generated");
      }
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
      setWaitingSince(null);
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

  const connected = (status.keyIssued || status.paired) && !!status.callbackUrl;
  const waitingElapsed = waitingSince ? Math.max(0, Math.floor((Date.now() - waitingSince) / 1000)) : 0;

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
              {connected && status.paired && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700">
                  <Wand2 className="w-2.5 h-2.5" /> Paired
                </span>
              )}
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
              if (window.confirm("Disconnect this clinic? Incoming prescriptions and dispensing updates both stop, and the connection credential is destroyed.")) {
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
      {connected && (status.prescriptionsReceived > 0 || status.failedDispenseUpdates > 0) && (
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

      <AnimatePresence mode="wait">
        {justPaired ? (
          <motion.div
            key="celebration"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-10 flex flex-col items-center text-center gap-3"
          >
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 340, damping: 16 }}
              className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center"
            >
              <Sparkles className="w-8 h-8 text-emerald-600" strokeWidth={2} />
            </motion.div>
            <p className="text-base font-black text-slate-800">
              {status.clinicName ?? "Your clinic"} is connected
            </p>
            <p className="text-xs text-slate-500 max-w-xs">
              Prescriptions will start arriving automatically — no further setup needed.
            </p>
          </motion.div>
        ) : connected ? (
          <motion.div key="connected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Connected clinic</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{status.clinicName || "—"}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {status.paired
                    ? `Paired${status.pairedAt ? ` ${format(new Date(status.pairedAt), "dd MMM yyyy, h:mm a")}` : ""}`
                    : `Connected${status.connectedAt ? ` ${format(new Date(status.connectedAt), "dd MMM yyyy, h:mm a")}` : ""}`}
                </p>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            </div>

            {/* Manual re-key stays reachable even once paired — a compromised key still
                needs a rotate button, whichever door originally connected it. */}
            {canManage && !status.paired && (
              <ManualKeySection
                status={status}
                issuedKey={issuedKey}
                showKey={showKey}
                setShowKey={setShowKey}
                copied={copied}
                copy={copy}
                generateKey={generateKey}
              />
            )}
          </motion.div>
        ) : (
          <motion.div key="disconnected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5">
            <div className="flex justify-center gap-1 mb-4">
              <ModeTab active={entryMode === "pairing"} onClick={() => setEntryMode("pairing")} icon={Wand2} label="Pair automatically" />
              <ModeTab active={entryMode === "manual"} onClick={() => setEntryMode("manual")} icon={KeyRound} label="Connect manually" />
            </div>

            {entryMode === "pairing" ? (
              <PairingFlow
                status={status}
                canManage={canManage}
                waitingSince={waitingSince}
                waitingElapsed={waitingElapsed}
                issuedKey={issuedKey}
                showKey={showKey}
                setShowKey={setShowKey}
                copied={copied}
                copy={copy}
                generateKey={generateKey}
              />
            ) : (
              <ManualFlow
                status={status}
                canManage={canManage}
                copied={copied}
                copy={copy}
                issuedKey={issuedKey}
                showKey={showKey}
                setShowKey={setShowKey}
                generateKey={generateKey}
                clinicName={clinicName}
                setClinicName={setClinicName}
                callbackUrl={callbackUrl}
                setCallbackUrl={setCallbackUrl}
                saveClinic={saveClinic}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!canManage && !connected && (
        <p className="px-5 pb-5 text-[11px] text-slate-400">
          Only an owner or manager can connect a clinic.
        </p>
      )}
    </motion.div>
  );
}

// ── Disconnected: pairing (default) ─────────────────────────────────────────

function ModeTab({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: typeof Wand2; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
        active ? "bg-brand-50 text-brand-700" : "text-slate-400 hover:text-slate-600",
      )}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function PairingFlow({ status, canManage, waitingSince, waitingElapsed, issuedKey, showKey, setShowKey, copied, copy, generateKey }: {
  status: ConnectionStatus;
  canManage: boolean;
  waitingSince: number | null;
  waitingElapsed: number;
  issuedKey: string | null;
  showKey: boolean;
  setShowKey: (fn: (v: boolean) => boolean) => void;
  copied: string | null;
  copy: (label: string, value: string) => void;
  generateKey: ReturnType<typeof useMutation<{ key: string; generatedAt: string }, unknown, void>>;
}) {
  if (!issuedKey || !waitingSince) {
    return (
      <div className="text-center py-6">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
          <Wand2 className="w-6 h-6 text-violet-600" strokeWidth={2} />
        </div>
        <p className="text-sm font-bold text-slate-800">Connect your clinic in one step</p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
          Generate a code, read it to whoever manages your clinic's checkup.care account along
          with your pharmacy's URL, and this screen updates itself the moment they're paired.
        </p>
        {canManage ? (
          <button
            onClick={() => generateKey.mutate()}
            disabled={generateKey.isPending}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-sm shadow-brand-600/20 disabled:opacity-50"
          >
            {generateKey.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Generate pairing code
          </button>
        ) : (
          <p className="mt-4 text-[11px] text-slate-400">Ask an owner or manager to generate a code.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3 text-center">
        Give these two things to your clinic
      </p>
      <div className="rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-5 space-y-3">
        <CopyRow label="Pharmacy URL" value={status.pharmacyUrl} copied={copied === "url"} onCopy={() => copy("url", status.pharmacyUrl)} />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Pairing code</span>
            {canManage && (
              <button
                onClick={() => generateKey.mutate()}
                disabled={generateKey.isPending}
                className="text-[11px] font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                {generateKey.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Regenerate
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2.5">
            <code className="flex-1 min-w-0 text-sm font-mono font-bold text-slate-800 tracking-wide break-all">
              {showKey ? issuedKey : "•".repeat(Math.min(issuedKey.length, 43))}
            </code>
            <button onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide code" : "Show code"}
              className="shrink-0 p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => copy("key", issuedKey)}
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600">
              {copied === "key" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copied === "key" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-brand-600">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-600" />
        </span>
        Waiting for your clinic to enter this
        <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
          <Clock className="w-3 h-3" /> {waitingElapsed}s
        </span>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 text-center">
        Stays valid until you generate a new one — no rush.
      </p>
    </div>
  );
}

// ── Disconnected: manual fallback ───────────────────────────────────────────

function ManualFlow({ status, canManage, copied, copy, issuedKey, showKey, setShowKey, generateKey,
  clinicName, setClinicName, callbackUrl, setCallbackUrl, saveClinic }: {
  status: ConnectionStatus;
  canManage: boolean;
  copied: string | null;
  copy: (label: string, value: string) => void;
  issuedKey: string | null;
  showKey: boolean;
  setShowKey: (fn: (v: boolean) => boolean) => void;
  generateKey: ReturnType<typeof useMutation<{ key: string; generatedAt: string }, unknown, void>>;
  clinicName: string;
  setClinicName: (v: string) => void;
  callbackUrl: string;
  setCallbackUrl: (v: string) => void;
  saveClinic: ReturnType<typeof useMutation<ConnectionStatus, unknown, void>>;
}) {
  return (
    <div className="space-y-6">
      <section>
        <StepHeading n={1} title="Give these to your clinic" />
        <p className="text-xs text-slate-500 mb-3">
          For a clinic connecting on the native machine surface, which authenticates by pharmacy
          id rather than a paired credential.
        </p>
        <div className="space-y-2">
          <CopyRow label="Pharmacy ID"   value={status.pharmacyId}   copied={copied === "id"}   onCopy={() => copy("id", status.pharmacyId)} />
          <CopyRow label="Display name"  value={status.pharmacyName} copied={copied === "name"} onCopy={() => copy("name", status.pharmacyName)} />
          <CopyRow label="Pharmacy URL"  value={status.pharmacyUrl}  copied={copied === "url"}  onCopy={() => copy("url", status.pharmacyUrl)} />
        </div>
      </section>

      <section>
        <StepHeading n={2} title="Generate the connection key" />
        <ManualKeySection status={status} issuedKey={issuedKey} showKey={showKey} setShowKey={setShowKey}
          copied={copied} copy={copy} generateKey={generateKey} />
      </section>

      <section>
        <StepHeading n={3} title="Point dispensing updates back at the clinic" />
        <p className="text-xs text-slate-500 mb-3">
          Paste the callback address your clinic's connection screen shows after it saves.
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
              placeholder="https://clinic.checkup.care/api/v1/pharmacy/webhooks/dispense"
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
    </div>
  );
}

function ManualKeySection({ status, issuedKey, showKey, setShowKey, copied, copy, generateKey }: {
  status: ConnectionStatus;
  issuedKey: string | null;
  showKey: boolean;
  setShowKey: (fn: (v: boolean) => boolean) => void;
  copied: string | null;
  copy: (label: string, value: string) => void;
  generateKey: ReturnType<typeof useMutation<{ key: string; generatedAt: string }, unknown, void>>;
}) {
  const canManage = getStoredUser()?.role === "OWNER" || getStoredUser()?.role === "MANAGER";
  return (
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
