import React, { useEffect, useState, useCallback } from "react";
import {
  Wallet,
  Sparkles,
  LayoutDashboard,
  ShieldCheck,
  ExternalLink,
  Zap,
} from "lucide-react";
import { api, AgentLogEntry, AgentSessionRecord, PayeeDirectoryEntry, PayrollRecord, StrategyInfo } from "./lib/api";
import { connectInjectedWallet, fetchTUsd8Balance, switchOrAddQDayNetwork, QDAY_AEVUM_TESTNET } from "./lib/qday";
import { AgentChat } from "./components/AgentChat";
import { PayrollsPanel } from "./components/PayrollsPanel";
import { SecurityAndRegistryPanel } from "./components/SecurityAndRegistryPanel";

type Tab = "chat" | "payrolls" | "security";

const DEMO_EMPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [account, setAccount] = useState<string | null>(null);
  const [tUsd8Balance, setTUsd8Balance] = useState<string>("0.00");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [contracts, setContracts] = useState<{ router: string; vault: string; registry: string; tUSD8: string }>({
    router: "",
    vault: "",
    registry: "",
    tUSD8: "0x456569838f1d43009A91ebA4263147Afd7233483",
  });

  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [payees, setPayees] = useState<PayeeDirectoryEntry[]>([]);
  const [session, setSession] = useState<AgentSessionRecord | null>(null);
  const [agentStatus, setAgentStatus] = useState<{
    erc8004AgentId: number;
    agentName: string;
    reputationScore: number;
    logs: AgentLogEntry[];
  } | null>(null);

  const activeEmployer = account || DEMO_EMPLOYER;

  const refreshData = useCallback(async () => {
    try {
      const [cfg, pRes, sRes, copRes, sessRes, agRes] = await Promise.all([
        api.getConfig(),
        api.getPayrolls(),
        api.getStrategies(),
        api.listPayees(),
        api.getSession(activeEmployer),
        api.getAgentStatus(),
      ]);
      setContracts(cfg.contracts);
      setPayrolls(pRes.payrolls);
      setStrategies(sRes.strategies);
      setPayees(copRes.payees);
      setSession(sessRes.session);
      setAgentStatus(agRes);
    } catch {
      // backend might be starting up
    }
  }, [activeEmployer]);

  useEffect(() => {
    refreshData();
    const timer = setInterval(refreshData, 6000);
    return () => clearInterval(timer);
  }, [refreshData]);

  const handleConnectWallet = async () => {
    try {
      const addr = await connectInjectedWallet();
      setAccount(addr);
      setIsDemoMode(false);
      const bal = await fetchTUsd8Balance(addr);
      setTUsd8Balance(bal);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 flex items-center justify-center text-slate-950 font-black text-lg">
              P
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white tracking-tight">PayDay</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 font-medium">
                  QDay Aevum Testnet · 44005
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Autonomous Yield-Generating Payroll & ERC-8004 Confirmation of Payee
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={QDAY_AEVUM_TESTNET.blockExplorers.default.url}
              target="_blank"
              rel="noreferrer"
              className="hidden md:inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-800"
            >
              Explorer <ExternalLink className="w-3 h-3" />
            </a>

            <button
              onClick={() => setIsDemoMode((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
                isDemoMode
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {isDemoMode ? "Demo Mode" : "Live Testnet"}
            </button>

            {account ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs">
                <span className="text-emerald-400 font-semibold">{tUsd8Balance} tUSD8</span>
                <span className="text-slate-500">|</span>
                <span className="font-mono text-slate-200">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition"
              >
                <Wallet className="w-4 h-4" />
                Connect QDay Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="inline-flex bg-slate-900/90 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setTab("chat")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                tab === "chat" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:text-white"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              AI Payroll Assistant
            </button>
            <button
              onClick={() => setTab("payrolls")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                tab === "payrolls" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:text-white"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Payrolls & Yield ({payrolls.length})
            </button>
            <button
              onClick={() => setTab("security")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                tab === "security" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:text-white"
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              ERC-8004 & Guardrails
            </button>
          </div>

          <button
            onClick={() => switchOrAddQDayNetwork().catch((e) => alert(e.message))}
            className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-4"
          >
            Add QDay Aevum Network to MetaMask
          </button>
        </div>

        <main className="pb-10">
          {tab === "chat" && (
            <AgentChat
              account={account}
              routerAddress={contracts.router}
              tUsd8Address={contracts.tUSD8}
              isDemoMode={isDemoMode}
              onPayrollCreated={() => {
                refreshData();
                setTab("payrolls");
              }}
            />
          )}
          {tab === "payrolls" && (
            <PayrollsPanel payrolls={payrolls} strategies={strategies} onRefresh={refreshData} />
          )}
          {tab === "security" && (
            <SecurityAndRegistryPanel
              employer={activeEmployer}
              payees={payees}
              session={session}
              agentStatus={agentStatus}
              onRefresh={refreshData}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
