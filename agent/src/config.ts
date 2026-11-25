import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

export const QDAY_TESTNET = {
  id: 44005,
  name: "QDay Aevum Testnet",
  rpcUrl: process.env.QDAY_RPC_URL || "https://rpc-test.qday.info",
  explorerUrl: "https://explorer-test.qday.info",
  currencySymbol: "tQDAY",
  tUSD8: (process.env.TUSD8_ADDRESS || "0x456569838f1d43009A91ebA4263147Afd7233483") as `0x${string}`,
};

function loadDeployments() {
  try {
    const depPath = path.resolve(__dirname, "../../contracts/deployments.json");
    if (fs.existsSync(depPath)) {
      return JSON.parse(fs.readFileSync(depPath, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

const deployments = loadDeployments();

export const CONTRACTS = {
  router: (process.env.ROUTER_ADDRESS || deployments.router || "") as string,
  vault: (process.env.VAULT_ADDRESS || deployments.vault || "") as string,
  registry: (process.env.REGISTRY_ADDRESS || deployments.registry || "") as string,
  tUSD8: (process.env.TUSD8_ADDRESS || deployments.tUSD8 || QDAY_TESTNET.tUSD8) as string,
};

export const AGENT_CONFIG = {
  port: Number(process.env.PORT || 3001),
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  executionPollMs: 15_000,
  apyPollMs: 45_000,
};

export const ROUTER_ABI = [
  {
    type: "function",
    name: "getActivePayrollIds",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "payrolls",
    inputs: [{ name: "payrollId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "employer", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "payrollDate", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "yieldReturned", type: "uint256" },
      { name: "stateHash", type: "bytes32" },
      { name: "executed", type: "bool" },
      { name: "cancelled", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "executePayroll",
    inputs: [{ name: "payrollId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rebalancePayroll",
    inputs: [
      { name: "payrollId", type: "uint256" },
      { name: "newStrategyId", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const VAULT_ABI = [
  {
    type: "function",
    name: "previewYield",
    inputs: [{ name: "payrollId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBestStrategy",
    inputs: [],
    outputs: [
      { name: "bestId", type: "uint8" },
      { name: "bestApyBps", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;
