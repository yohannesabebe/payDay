import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_CONFIG, CONTRACTS, QDAY_TESTNET, ROUTER_ABI } from "../config";
import { store } from "../store";

const qdayChain = defineChain({
  id: QDAY_TESTNET.id,
  name: QDAY_TESTNET.name,
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [QDAY_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "QDay Explorer", url: QDAY_TESTNET.explorerUrl } },
});

let executionTimer: NodeJS.Timeout | null = null;
let apyTimer: NodeJS.Timeout | null = null;

async function tryOnChainExecute(payrollId: number): Promise<string | undefined> {
  if (!CONTRACTS.router || !AGENT_CONFIG.agentPrivateKey) return undefined;
  try {
    const pk = AGENT_CONFIG.agentPrivateKey.startsWith("0x")
      ? (AGENT_CONFIG.agentPrivateKey as `0x${string}`)
      : (`0x${AGENT_CONFIG.agentPrivateKey}` as `0x${string}`);
    const account = privateKeyToAccount(pk);
    const publicClient = createPublicClient({ chain: qdayChain, transport: http() });
    const walletClient = createWalletClient({ account, chain: qdayChain, transport: http() });

    const hash = await walletClient.writeContract({
      address: CONTRACTS.router as `0x${string}`,
      abi: ROUTER_ABI,
      functionName: "executePayroll",
      args: [BigInt(payrollId)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    store.addLog("SYSTEM", `On-chain execution fallback for Payroll #${payrollId}: ${(err as Error).message}`);
    return undefined;
  }
}

export async function runExecutionCycle() {
  const now = Math.floor(Date.now() / 1000);
  const payrolls = store.listPayrolls();
  const due = payrolls.filter((p) => !p.executed && !p.cancelled && p.payrollDate <= now);

  for (const p of due) {
    let txHash: string | undefined;
    if (p.mode === "onchain" && CONTRACTS.router && AGENT_CONFIG.agentPrivateKey) {
      txHash = await tryOnChainExecute(p.id);
    }
    store.executePayroll(p.id, txHash);
  }
}

export function runApyMonitorCycle() {
  const now = Math.floor(Date.now() / 1000);
  const best = store.getBestStrategy();
  const payrolls = store.listPayrolls();
  const active = payrolls.filter((p) => !p.executed && !p.cancelled);

  for (const p of active) {
    const timeToPayday = p.payrollDate - now;
    if (timeToPayday > 86400 && p.strategyId !== best.id) {
      const current = store.getStrategies().find((s) => s.id === p.strategyId);
      if (current && best.apyBps - current.apyBps >= 200) {
        store.rebalancePayroll(
          p.id,
          best.id,
          `APY upgraded from ${(current.apyBps / 100).toFixed(2)}% to ${(best.apyBps / 100).toFixed(2)}%`
        );
      }
    }
  }
}

export function startAutonomousAgent() {
  if (executionTimer || apyTimer) return;
  executionTimer = setInterval(() => {
    runExecutionCycle().catch((e) => console.error("Execution cycle error:", e));
  }, AGENT_CONFIG.executionPollMs);

  apyTimer = setInterval(() => {
    runApyMonitorCycle();
  }, AGENT_CONFIG.apyPollMs);

  console.log(
    `[PayDay Agent] Autonomous loops started (Execution: ${AGENT_CONFIG.executionPollMs / 1000}s, APY Monitor: ${
      AGENT_CONFIG.apyPollMs / 1000
    }s)`
  );
}
