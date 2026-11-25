import React, { useState } from "react";
import { ShieldCheck, Lock, UserPlus, Activity, Ban, CheckCircle2, RefreshCw } from "lucide-react";
import { api, AgentLogEntry, AgentSessionRecord, PayeeDirectoryEntry } from "../lib/api";

interface SecurityAndRegistryPanelProps {
  employer: string;
  payees: PayeeDirectoryEntry[];
  session: AgentSessionRecord | null;
  agentStatus: {
    erc8004AgentId: number;
    agentName: string;
    reputationScore: number;
    logs: AgentLogEntry[];
  } | null;
  onRefresh: () => void;
}

export const SecurityAndRegistryPanel: React.FC<SecurityAndRegistryPanelProps> = ({
  employer,
  payees,
  session,
  agentStatus,
  onRefresh,
}) => {
  const [budgetCap, setBudgetCap] = useState("25000");
  const [days, setDays] = useState("30");

  const [handle, setHandle] = useState("");
  const [wallet, setWallet] = useState("");
  const [displayName, setDisplayName] = useState("");

  const handleGrantSession = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.grantSession({
      employer,
      budgetCap: Number(budgetCap),
      durationSeconds: Number(days) * 86400,
    });
    onRefresh();
  };

  const handleRevokeSession = async () => {
    await api.revokeSession(employer);
    onRefresh();
  };

  const handleRegisterPayee = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.registerPayee({ handle, wallet, displayName });
    setHandle("");
    setWallet("");
    setDisplayName("");
    onRefresh();
  };

  const handleTick = async () => {
    await api.triggerAgentTick();
    onRefresh();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Scoped Agent Session Guardrails */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-sky-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Scoped Agent Session & Guardrails</h3>
              <p className="text-xs text-slate-400">Least-privilege execution cap, expiry & instant kill switch</p>
            </div>
          </div>
          {session?.active ? (
            <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              Active
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-xs bg-slate-800 text-slate-400">
              {session ? "Revoked" : "Default"}
            </span>
          )}
        </div>

        {session && (
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Max Budget Cap / Payroll:</span>
              <span className="font-semibold text-white">{session.budgetCap.toLocaleString()} tUSD8</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Session Expiry:</span>
              <span className="font-semibold text-slate-200">{new Date(session.expiry * 1000).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleGrantSession} className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Budget Cap (tUSD8)</label>
            <input
              type="number"
              value={budgetCap}
              onChange={(e) => setBudgetCap(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Duration (Days)</label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
          <button
            type="submit"
            className="col-span-1 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition"
          >
            Update Session Cap
          </button>
          <button
            type="button"
            onClick={handleRevokeSession}
            className="col-span-1 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-semibold text-xs transition flex items-center justify-center gap-1.5"
          >
            <Ban className="w-3.5 h-3.5" />
            Revoke Session
          </button>
        </form>
      </div>

      {/* ERC-8004 Agent Identity */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">
                ERC-8004 Agent #{agentStatus?.erc8004AgentId ?? 1}
              </h3>
              <p className="text-xs text-slate-400">{agentStatus?.agentName ?? "PayDay Autonomous Agent"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              Reputation: {agentStatus?.reputationScore ?? 98}/100
            </span>
            <button
              onClick={handleTick}
              title="Trigger autonomous agent cycle"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
          {(agentStatus?.logs || []).slice(0, 12).map((log) => (
            <div key={log.id} className="bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                <span className="font-semibold text-sky-400">{log.category}</span>
                <span>{new Date(log.timestamp * 1000).toLocaleTimeString()}</span>
              </div>
              <div className="text-slate-300">{log.message}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmation of Payee (.qday) Registry */}
      <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-white">Confirmation of Payee (.qday) Registry</h3>
            <p className="text-xs text-slate-400">
              Verified identity-to-address directory preventing misdirected payrolls
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {payees.map((p) => (
            <div key={p.handle} className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">{p.handle}</span>
                {p.verified ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">Unverified</span>
                )}
              </div>
              <div className="text-slate-300">{p.displayName}</div>
              <div className="text-[11px] text-slate-500 font-mono truncate">{p.wallet}</div>
            </div>
          ))}
        </div>

        <form onSubmit={handleRegisterPayee} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Handle (e.g. elena.qday)"
            required
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Full Legal Name"
            required
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
          />
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x... Wallet Address"
            required
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
          />
          <button
            type="submit"
            className="py-2 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Register & Verify Payee
          </button>
        </form>
      </div>
    </div>
  );
};
