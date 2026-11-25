import React from "react";
import { TrendingUp, Clock, CheckCircle2, XCircle, RefreshCw, Play, ShieldAlert } from "lucide-react";
import { api, PayrollRecord, StrategyInfo } from "../lib/api";

interface PayrollsPanelProps {
  payrolls: PayrollRecord[];
  strategies: StrategyInfo[];
  onRefresh: () => void;
}

export const PayrollsPanel: React.FC<PayrollsPanelProps> = ({ payrolls, strategies, onRefresh }) => {
  const getStrategy = (id: number) => strategies.find((s) => s.id === id);
  const bestStrategy = [...strategies].sort((a, b) => b.apyBps - a.apyBps)[0];

  const handleExecute = async (id: number) => {
    try {
      await api.executePayroll(id);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleRebalance = async (id: number, toStrategyId: number) => {
    try {
      await api.rebalancePayroll(id, toStrategyId);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await api.cancelPayroll(id);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const totalPrincipal = payrolls.filter((p) => !p.cancelled).reduce((s, p) => s + p.principal, 0);
  const totalYield = payrolls.reduce((s, p) => s + p.yieldEarned, 0);
  const activeCount = payrolls.filter((p) => !p.executed && !p.cancelled).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Total Payroll Volume</div>
          <div className="text-2xl font-bold text-white mt-1">{totalPrincipal.toLocaleString()} tUSD8</div>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Yield Earned for Employers</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">+{totalYield.toFixed(6)} tUSD8</div>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400">Active Yield-Earning Payrolls</div>
          <div className="text-2xl font-bold text-sky-400 mt-1">{activeCount}</div>
        </div>
      </div>

      {payrolls.length === 0 ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-10 text-center text-slate-400 text-sm">
          No payrolls created yet. Use the **AI Assistant** tab to schedule your first yield-generating payroll!
        </div>
      ) : (
        <div className="space-y-4">
          {payrolls.map((p) => {
            const strat = getStrategy(p.strategyId);
            const now = Math.floor(Date.now() / 1000);
            const isDue = now >= p.payrollDate;

            return (
              <div key={p.id} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-white">Payroll #{p.id}</span>
                      {p.executed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Executed
                        </span>
                      ) : p.cancelled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
                          <XCircle className="w-3.5 h-3.5" /> Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
                          <Clock className="w-3.5 h-3.5" /> {isDue ? "Ready for Execution" : "Earning Yield"}
                        </span>
                      )}
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                        {p.mode}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Payday: {new Date(p.payrollDate * 1000).toLocaleString()} · StateHash:{" "}
                      <span className="font-mono text-slate-500">{p.stateHash.slice(0, 14)}...</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-bold text-white">{p.principal.toLocaleString()} tUSD8</div>
                    <div className="text-xs text-emerald-400 font-medium flex items-center justify-end gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      +{p.yieldEarned.toFixed(6)} tUSD8 yield ({strat ? `${(strat.apyBps / 100).toFixed(2)}% APY` : ""})
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {p.recipients.map((r, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-200">{r.handle}</div>
                        <div className="text-[11px] text-slate-500">{r.displayName}</div>
                      </div>
                      <div className="font-semibold text-white">{r.amount.toLocaleString()} tUSD8</div>
                    </div>
                  ))}
                </div>

                {!p.executed && !p.cancelled && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      onClick={() => handleExecute(p.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Execute & Distribute Now
                    </button>
                    {bestStrategy && p.strategyId !== bestStrategy.id && (
                      <button
                        onClick={() => handleRebalance(p.id, bestStrategy.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Rebalance to {bestStrategy.name} ({(bestStrategy.apyBps / 100).toFixed(2)}%)
                      </button>
                    )}
                    <button
                      onClick={() => handleCancel(p.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-medium transition ml-auto"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Emergency Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
