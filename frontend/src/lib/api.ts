export interface RecipientRecord {
  wallet: string;
  handle: string;
  displayName: string;
  amount: number;
  copVerified: boolean;
}

export interface StrategyInfo {
  id: number;
  name: string;
  protocol: string;
  apyBps: number;
  risk: string;
  tvlUsd: number;
}

export interface PayrollProposal {
  totalAmount: number;
  payrollDate: number;
  payrollDateLabel: string;
  strategyId: number;
  strategyName: string;
  estimatedApyBps: number;
  recipients: RecipientRecord[];
  warnings: string[];
}

export interface PayrollRecord {
  id: number;
  employer: string;
  principal: number;
  payrollDate: number;
  createdAt: number;
  strategyId: number;
  recipients: RecipientRecord[];
  stateHash: string;
  txHash?: string;
  executed: boolean;
  cancelled: boolean;
  yieldEarned: number;
  rebalanceHistory: Array<{
    timestamp: number;
    fromStrategyId: number;
    toStrategyId: number;
    reason: string;
  }>;
  mode: "onchain" | "simulation";
}

export interface PayeeDirectoryEntry {
  handle: string;
  wallet: string;
  displayName: string;
  verified: boolean;
  updatedAt: number;
}

export interface AgentSessionRecord {
  employer: string;
  budgetCap: number;
  expiry: number;
  active: boolean;
}

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  category: string;
  message: string;
  payrollId?: number;
  txHash?: string;
}

const BASE = "/api";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API request failed");
  return data as T;
}

export const api = {
  getConfig: () => jsonFetch<{ network: any; contracts: { router: string; vault: string; registry: string; tUSD8: string } }>("/config"),
  getStrategies: () => jsonFetch<{ strategies: StrategyInfo[] }>("/strategies"),
  getPayrolls: (employer?: string) =>
    jsonFetch<{ payrolls: PayrollRecord[] }>(employer ? `/payrolls?employer=${encodeURIComponent(employer)}` : "/payrolls"),
  createPayroll: (body: {
    employer: string;
    principal: number;
    payrollDate: number;
    strategyId: number;
    recipients: RecipientRecord[];
    txHash?: string;
    mode?: "onchain" | "simulation";
  }) => jsonFetch<{ payroll: PayrollRecord }>("/payrolls", { method: "POST", body: JSON.stringify(body) }),
  executePayroll: (id: number) => jsonFetch<{ payroll: PayrollRecord }>(`/payrolls/${id}/execute`, { method: "POST" }),
  rebalancePayroll: (id: number, toStrategyId: number) =>
    jsonFetch<{ payroll: PayrollRecord }>(`/payrolls/${id}/rebalance`, {
      method: "POST",
      body: JSON.stringify({ toStrategyId }),
    }),
  cancelPayroll: (id: number) => jsonFetch<{ payroll: PayrollRecord }>(`/payrolls/${id}/cancel`, { method: "POST" }),
  listPayees: () => jsonFetch<{ payees: PayeeDirectoryEntry[] }>("/cop/list"),
  registerPayee: (body: { handle: string; wallet: string; displayName: string }) =>
    jsonFetch<{ payee: PayeeDirectoryEntry }>("/cop/register", { method: "POST", body: JSON.stringify(body) }),
  getSession: (employer: string) => jsonFetch<{ session: AgentSessionRecord | null }>(`/sessions/${employer}`),
  grantSession: (body: { employer: string; budgetCap: number; durationSeconds: number }) =>
    jsonFetch<{ session: AgentSessionRecord }>("/sessions", { method: "POST", body: JSON.stringify(body) }),
  revokeSession: (employer: string) =>
    jsonFetch<{ session: AgentSessionRecord | null }>("/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ employer }),
    }),
  getAgentStatus: () =>
    jsonFetch<{ erc8004AgentId: number; agentName: string; reputationScore: number; logs: AgentLogEntry[] }>("/agent/status"),
  triggerAgentTick: () => jsonFetch<{ ok: boolean; logs: AgentLogEntry[] }>("/agent/tick", { method: "POST" }),
  sendChat: (message: string) =>
    jsonFetch<{ reply: string; proposal?: PayrollProposal }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  parseCsv: (csv: string, daysUntilPayday = 7) =>
    jsonFetch<{ proposal: PayrollProposal }>("/csv/parse", {
      method: "POST",
      body: JSON.stringify({ csv, daysUntilPayday }),
    }),
};
