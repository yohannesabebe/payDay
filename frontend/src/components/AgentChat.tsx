import React, { useState, useRef } from "react";
import { Send, Upload, ShieldCheck, AlertTriangle, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { api, PayrollProposal } from "../lib/api";
import { sendOnChainPayrollDeposit } from "../lib/qday";

interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: PayrollProposal;
  deployedTx?: string;
}

interface AgentChatProps {
  account: string | null;
  routerAddress: string;
  tUsd8Address: string;
  isDemoMode: boolean;
  onPayrollCreated: () => void;
}

const QUICK_PROMPTS = [
  "Pay alice.qday 2500 and bob.qday 3200 in 7 days",
  "Pay carol.qday 1800 in 1 minute",
  "Show live QDay yield strategies and APYs",
];

export const AgentChat: React.FC<AgentChatProps> = ({
  account,
  routerAddress,
  tUsd8Address,
  isDemoMode,
  onPayrollCreated,
}) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Welcome to **PayDay** on **QDay Aevum Testnet**! Tell me who to pay in plain English (using `.qday` Confirmation of Payee handles or `0x` addresses), or upload a CSV. Idle `tUSD8` earns DeFi yield until payday, then I return 100% of the yield to you and pay your team automatically.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessageItem = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await api.sendChat(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: res.reply,
          proposal: res.proposal,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", content: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const csv = await file.text();
    setMessages((prev) => [
      ...prev,
      { id: `u-csv-${Date.now()}`, role: "user", content: `Uploaded CSV: ${file.name}` },
    ]);
    setLoading(true);
    try {
      const res = await api.parseCsv(csv, 7);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-csv-${Date.now()}`,
          role: "assistant",
          content: `Parsed **${file.name}** (${res.proposal.recipients.length} recipients, total **${res.proposal.totalAmount.toLocaleString()} tUSD8**). Review Confirmation of Payee checks and deploy below:`,
          proposal: res.proposal,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `e-csv-${Date.now()}`, role: "assistant", content: `CSV Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeployProposal = async (msgId: string, proposal: PayrollProposal) => {
    const employer = account || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    setDeployingId(msgId);
    try {
      let txHash: string | undefined;
      let mode: "onchain" | "simulation" = "simulation";

      if (!isDemoMode && account && routerAddress && tUsd8Address) {
        txHash = await sendOnChainPayrollDeposit({
          account: account as `0x${string}`,
          routerAddress: routerAddress as `0x${string}`,
          tokenAddress: tUsd8Address as `0x${string}`,
          totalAmount: proposal.totalAmount,
          payrollDate: proposal.payrollDate,
          strategyId: proposal.strategyId,
          recipients: proposal.recipients.map((r) => ({
            wallet: r.wallet,
            amount: r.amount,
            handle: r.handle,
          })),
        });
        mode = "onchain";
      }

      await api.createPayroll({
        employer,
        principal: proposal.totalAmount,
        payrollDate: proposal.payrollDate,
        strategyId: proposal.strategyId,
        recipients: proposal.recipients,
        txHash,
        mode,
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, deployedTx: txHash || "sim-verified" } : m))
      );
      onPayrollCreated();
    } catch (err) {
      alert(`Deployment failed: ${(err as Error).message}`);
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">PayDay AI Treasury Assistant</h2>
            <p className="text-xs text-slate-400">Natural language payroll, CSV batching & .qday Confirmation of Payee</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-sky-600 text-white"
                  : "bg-slate-800/80 border border-slate-700/80 text-slate-200"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>

              {m.proposal && (
                <div className="mt-4 bg-slate-950/90 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div>
                      <span className="text-xs uppercase tracking-wider text-sky-400 font-semibold">
                        Payroll Proposal · {m.proposal.payrollDateLabel}
                      </span>
                      <div className="text-base font-bold text-white mt-0.5">
                        {m.proposal.totalAmount.toLocaleString()} tUSD8
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {(m.proposal.estimatedApyBps / 100).toFixed(2)}% APY · {m.proposal.strategyName}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {m.proposal.recipients.map((r, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800"
                      >
                        <div className="flex items-center gap-2">
                          {r.copVerified ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          )}
                          <div>
                            <span className="font-semibold text-white">{r.handle}</span>
                            <span className="text-slate-400 ml-1.5">({r.displayName})</span>
                            <div className="text-[11px] text-slate-500 font-mono">{r.wallet}</div>
                          </div>
                        </div>
                        <div className="font-semibold text-slate-100">{r.amount.toLocaleString()} tUSD8</div>
                      </div>
                    ))}
                  </div>

                  {m.proposal.warnings.length > 0 && (
                    <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 space-y-1">
                      {m.proposal.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}

                  {m.deployedTx ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Deployed to QDay Yield Vault!{" "}
                        {m.deployedTx !== "sim-verified" ? `Tx: ${m.deployedTx.slice(0, 14)}...` : "(Simulation Mode)"}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDeployProposal(m.id, m.proposal!)}
                      disabled={deployingId === m.id}
                      className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-xs transition flex items-center justify-center gap-2"
                    >
                      {deployingId === m.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Deploying & Locking Yield Position...
                        </>
                      ) : isDemoMode || !routerAddress ? (
                        "Deploy Payroll to Yield Vault (Demo Mode)"
                      ) : (
                        "Approve tUSD8 & Deploy on QDay Aevum"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            PayDay AI is validating recipients and QDay yield rates...
          </div>
        )}
      </div>

      <div className="px-5 py-2.5 border-t border-slate-800/80 bg-slate-900/60 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            onClick={() => sendMessage(q)}
            className="text-xs px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-4 border-t border-slate-800 bg-slate-900/90 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Try: "Pay alice.qday 2500 and bob.qday 3200 in 7 days"'
          className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center gap-1.5 transition"
        >
          <Send className="w-4 h-4" />
          Send
        </button>
      </form>
    </div>
  );
};
