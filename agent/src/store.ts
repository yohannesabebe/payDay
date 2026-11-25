import * as fs from "fs";
import * as path from "path";
import { keccak256, toHex } from "viem";

export interface RecipientRecord {
  wallet: string;
  handle: string;
  displayName: string;
  amount: number; // human-readable tUSD8 (e.g. 2500)
  copVerified: boolean;
}

export interface StrategyInfo {
  id: number;
  name: string;
  protocol: string;
  apyBps: number;
  risk: "Low" | "Low-Medium" | "Medium";
  tvlUsd: number;
}

export interface PayrollRecord {
  id: number;
  employer: string;
  principal: number; // tUSD8
  payrollDate: number; // unix seconds
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
  category: "EXECUTION" | "APY_MONITOR" | "REBALANCE" | "COP_VERIFY" | "GUARDRAIL" | "SYSTEM";
  message: string;
  payrollId?: number;
  txHash?: string;
}

interface StoreData {
  nextPayrollId: number;
  strategies: StrategyInfo[];
  payees: PayeeDirectoryEntry[];
  payrolls: PayrollRecord[];
  sessions: AgentSessionRecord[];
  logs: AgentLogEntry[];
}

const DATA_DIR = path.resolve(__dirname, "../../data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const DEFAULT_STRATEGIES: StrategyInfo[] = [
  {
    id: 0,
    name: "QDay Stable LP (tUSD8/tQDAY)",
    protocol: "QDaySwap V3",
    apyBps: 850,
    risk: "Low",
    tvlUsd: 1_240_000,
  },
  {
    id: 1,
    name: "Aevum Treasury Pool",
    protocol: "Aevum T-Bill Vault",
    apyBps: 1420,
    risk: "Low",
    tvlUsd: 3_850_000,
  },
  {
    id: 2,
    name: "Quantum Liquidity Pool",
    protocol: "QDay Prime Yield",
    apyBps: 2100,
    risk: "Low-Medium",
    tvlUsd: 920_000,
  },
];

const DEFAULT_PAYEES: PayeeDirectoryEntry[] = [
  {
    handle: "alice.qday",
    wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    displayName: "Alice Chen",
    verified: true,
    updatedAt: Math.floor(Date.now() / 1000),
  },
  {
    handle: "bob.qday",
    wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    displayName: "Bob Martinez",
    verified: true,
    updatedAt: Math.floor(Date.now() / 1000),
  },
  {
    handle: "carol.qday",
    wallet: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    displayName: "Carol Okafor",
    verified: true,
    updatedAt: Math.floor(Date.now() / 1000),
  },
  {
    handle: "dave.qday",
    wallet: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    displayName: "Dave Patel",
    verified: false,
    updatedAt: Math.floor(Date.now() / 1000),
  },
];

class Store {
  private data: StoreData;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      this.data = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    } else {
      this.data = {
        nextPayrollId: 1,
        strategies: DEFAULT_STRATEGIES,
        payees: DEFAULT_PAYEES,
        payrolls: [],
        sessions: [],
        logs: [
          {
            id: "init-1",
            timestamp: Math.floor(Date.now() / 1000),
            category: "SYSTEM",
            message: "PayDay Autonomous Agent initialized on QDay Aevum Testnet (Chain ID 44005).",
          },
        ],
      };
      this.save();
    }
  }

  private save() {
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.data, null, 2));
  }

  getStrategies(): StrategyInfo[] {
    return this.data.strategies;
  }

  getBestStrategy(): StrategyInfo {
    return [...this.data.strategies].sort((a, b) => b.apyBps - a.apyBps)[0];
  }

  listPayees(): PayeeDirectoryEntry[] {
    return this.data.payees;
  }

  resolvePayee(query: string): PayeeDirectoryEntry | undefined {
    const q = query.trim().toLowerCase();
    return this.data.payees.find(
      (p) => p.handle.toLowerCase() === q || p.wallet.toLowerCase() === q
    );
  }

  registerPayee(handle: string, wallet: string, displayName: string, verified = true): PayeeDirectoryEntry {
    const norm = handle.trim().toLowerCase();
    const existingIdx = this.data.payees.findIndex((p) => p.handle.toLowerCase() === norm);
    const entry: PayeeDirectoryEntry = {
      handle: norm,
      wallet,
      displayName,
      verified,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    if (existingIdx >= 0) {
      this.data.payees[existingIdx] = entry;
    } else {
      this.data.payees.push(entry);
    }
    this.addLog("COP_VERIFY", `Registered Confirmation of Payee: ${norm} -> ${wallet} (${displayName})`);
    this.save();
    return entry;
  }

  listPayrolls(employer?: string): PayrollRecord[] {
    const list = employer
      ? this.data.payrolls.filter((p) => p.employer.toLowerCase() === employer.toLowerCase())
      : this.data.payrolls;
    return list.map((p) => ({
      ...p,
      yieldEarned: p.executed || p.cancelled ? p.yieldEarned : this.computeAccruedYield(p),
    }));
  }

  getPayroll(id: number): PayrollRecord | undefined {
    const p = this.data.payrolls.find((item) => item.id === id);
    if (!p) return undefined;
    return {
      ...p,
      yieldEarned: p.executed || p.cancelled ? p.yieldEarned : this.computeAccruedYield(p),
    };
  }

  computeAccruedYield(p: PayrollRecord): number {
    const now = Math.floor(Date.now() / 1000);
    const end = Math.min(now, p.payrollDate);
    if (end <= p.createdAt) return 0;
    const elapsed = end - p.createdAt;
    const strategy = this.data.strategies.find((s) => s.id === p.strategyId);
    const apyBps = strategy ? strategy.apyBps : 1420;
    // Standard pro-rata yield
    const yieldAmount = (p.principal * (apyBps / 10000) * elapsed) / (365 * 24 * 60 * 60);
    return Number(yieldAmount.toFixed(6));
  }

  createPayroll(input: {
    employer: string;
    principal: number;
    payrollDate: number;
    strategyId: number;
    recipients: RecipientRecord[];
    txHash?: string;
    mode?: "onchain" | "simulation";
  }): PayrollRecord {
    const id = this.data.nextPayrollId++;
    const createdAt = Math.floor(Date.now() / 1000);
    const stateHash = keccak256(
      toHex(JSON.stringify({ id, employer: input.employer, principal: input.principal, payrollDate: input.payrollDate }))
    );

    const record: PayrollRecord = {
      id,
      employer: input.employer,
      principal: input.principal,
      payrollDate: input.payrollDate,
      createdAt,
      strategyId: input.strategyId,
      recipients: input.recipients,
      stateHash,
      txHash: input.txHash,
      executed: false,
      cancelled: false,
      yieldEarned: 0,
      rebalanceHistory: [],
      mode: input.mode || "simulation",
    };

    this.data.payrolls.unshift(record);
    this.addLog(
      "SYSTEM",
      `Payroll #${id} created (${input.principal.toLocaleString()} tUSD8, ${input.recipients.length} recipients) in Strategy #${input.strategyId}.`,
      id,
      input.txHash
    );
    this.save();
    return record;
  }

  rebalancePayroll(id: number, toStrategyId: number, reason: string): PayrollRecord | undefined {
    const p = this.data.payrolls.find((item) => item.id === id);
    if (!p || p.executed || p.cancelled) return undefined;
    const fromStrategyId = p.strategyId;
    p.strategyId = toStrategyId;
    p.rebalanceHistory.push({
      timestamp: Math.floor(Date.now() / 1000),
      fromStrategyId,
      toStrategyId,
      reason,
    });
    this.addLog(
      "REBALANCE",
      `Rebalanced Payroll #${id} from Strategy #${fromStrategyId} -> #${toStrategyId}: ${reason}`,
      id
    );
    this.save();
    return p;
  }

  executePayroll(id: number, txHash?: string): PayrollRecord | undefined {
    const p = this.data.payrolls.find((item) => item.id === id);
    if (!p || p.executed || p.cancelled) return undefined;

    // Enforce scoped session guardrail if present
    const session = this.getSession(p.employer);
    if (session) {
      const now = Math.floor(Date.now() / 1000);
      if (!session.active) {
        this.addLog("GUARDRAIL", `Blocked execution of Payroll #${id}: Agent session revoked by employer.`, id);
        return undefined;
      }
      if (now > session.expiry) {
        this.addLog("GUARDRAIL", `Blocked execution of Payroll #${id}: Agent session expired.`, id);
        return undefined;
      }
      if (p.principal > session.budgetCap) {
        this.addLog(
          "GUARDRAIL",
          `Blocked execution of Payroll #${id}: Principal ${p.principal} exceeds session cap ${session.budgetCap}.`,
          id
        );
        return undefined;
      }
    }

    p.yieldEarned = this.computeAccruedYield(p);
    p.executed = true;
    if (txHash) p.txHash = txHash;

    this.addLog(
      "EXECUTION",
      `Executed Payroll #${id}: Distributed ${p.principal.toLocaleString()} tUSD8 to ${p.recipients.length} payees & returned ${p.yieldEarned.toFixed(4)} tUSD8 yield to employer.`,
      id,
      txHash
    );
    this.save();
    return p;
  }

  cancelPayroll(id: number): PayrollRecord | undefined {
    const p = this.data.payrolls.find((item) => item.id === id);
    if (!p || p.executed || p.cancelled) return undefined;
    p.yieldEarned = this.computeAccruedYield(p);
    p.cancelled = true;
    this.addLog(
      "GUARDRAIL",
      `Employer cancelled Payroll #${id}. Returned ${(p.principal + p.yieldEarned).toFixed(4)} tUSD8 to employer.`,
      id
    );
    this.save();
    return p;
  }

  upsertSession(employer: string, budgetCap: number, durationSeconds: number): AgentSessionRecord {
    const expiry = Math.floor(Date.now() / 1000) + durationSeconds;
    const idx = this.data.sessions.findIndex((s) => s.employer.toLowerCase() === employer.toLowerCase());
    const rec: AgentSessionRecord = { employer, budgetCap, expiry, active: true };
    if (idx >= 0) this.data.sessions[idx] = rec;
    else this.data.sessions.push(rec);
    this.addLog(
      "GUARDRAIL",
      `Scoped agent session granted by ${employer.slice(0, 8)}... (Cap: ${budgetCap.toLocaleString()} tUSD8).`
    );
    this.save();
    return rec;
  }

  revokeSession(employer: string): AgentSessionRecord | undefined {
    const s = this.data.sessions.find((item) => item.employer.toLowerCase() === employer.toLowerCase());
    if (!s) return undefined;
    s.active = false;
    this.addLog("GUARDRAIL", `Agent session REVOKED by ${employer.slice(0, 8)}...`);
    this.save();
    return s;
  }

  getSession(employer: string): AgentSessionRecord | undefined {
    return this.data.sessions.find((s) => s.employer.toLowerCase() === employer.toLowerCase());
  }

  getLogs(limit = 50): AgentLogEntry[] {
    return this.data.logs.slice(0, limit);
  }

  addLog(category: AgentLogEntry["category"], message: string, payrollId?: number, txHash?: string) {
    this.data.logs.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Math.floor(Date.now() / 1000),
      category,
      message,
      payrollId,
      txHash,
    });
    if (this.data.logs.length > 150) {
      this.data.logs = this.data.logs.slice(0, 150);
    }
    this.save();
  }
}

export const store = new Store();
