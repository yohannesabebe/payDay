import { createPublicClient, createWalletClient, custom, defineChain, http, parseUnits, formatUnits } from "viem";

export const QDAY_AEVUM_TESTNET = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: {
    name: "tQDAY",
    symbol: "tQDAY",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc-test.qday.info"],
      webSocket: ["wss://rpc-test.qday.info"],
    },
  },
  blockExplorers: {
    default: {
      name: "QDay Testnet Explorer",
      url: "https://explorer-test.qday.info",
    },
  },
});

export const TUSD8_ADDRESS = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export const ROUTER_ABI = [
  {
    type: "function",
    name: "createPayroll",
    inputs: [
      { name: "totalAmount", type: "uint256" },
      { name: "payrollDate", type: "uint256" },
      {
        name: "recipients",
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "handle", type: "string" },
        ],
      },
      { name: "strategyId", type: "uint8" },
    ],
    outputs: [{ name: "payrollId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "grantAgentSession",
    inputs: [
      { name: "agent", type: "address" },
      { name: "budgetCap", type: "uint256" },
      { name: "durationSeconds", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeAgentSession",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const publicClient = createPublicClient({
  chain: QDAY_AEVUM_TESTNET,
  transport: http("https://rpc-test.qday.info"),
});

export async function switchOrAddQDayNetwork(): Promise<void> {
  const eth = (window as unknown as { ethereum?: any }).ethereum;
  if (!eth) throw new Error("No EVM wallet detected. Install MetaMask or use Demo Mode.");

  const chainHex = `0x${QDAY_AEVUM_TESTNET.id.toString(16)}`; // 0xabe5
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainHex,
            chainName: QDAY_AEVUM_TESTNET.name,
            nativeCurrency: QDAY_AEVUM_TESTNET.nativeCurrency,
            rpcUrls: ["https://rpc-test.qday.info"],
            blockExplorerUrls: ["https://explorer-test.qday.info/"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function connectInjectedWallet(): Promise<`0x${string}`> {
  const eth = (window as unknown as { ethereum?: any }).ethereum;
  if (!eth) throw new Error("MetaMask / EIP-1193 wallet not found");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) throw new Error("No account authorized");
  await switchOrAddQDayNetwork();
  return accounts[0] as `0x${string}`;
}

export async function fetchTUsd8Balance(address: `0x${string}`): Promise<string> {
  try {
    const raw = await publicClient.readContract({
      address: TUSD8_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    return Number(formatUnits(raw, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return "0.00";
  }
}

export async function sendOnChainPayrollDeposit(params: {
  account: `0x${string}`;
  routerAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  totalAmount: number;
  payrollDate: number;
  strategyId: number;
  recipients: Array<{ wallet: string; amount: number; handle: string }>;
}): Promise<string> {
  const eth = (window as unknown as { ethereum?: any }).ethereum;
  if (!eth) throw new Error("No wallet provider");

  const walletClient = createWalletClient({
    account: params.account,
    chain: QDAY_AEVUM_TESTNET,
    transport: custom(eth),
  });

  const amountUnits = parseUnits(params.totalAmount.toString(), 6);

  const approveHash = await walletClient.writeContract({
    address: params.tokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [params.routerAddress, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const depositHash = await walletClient.writeContract({
    address: params.routerAddress,
    abi: ROUTER_ABI,
    functionName: "createPayroll",
    args: [
      amountUnits,
      BigInt(params.payrollDate),
      params.recipients.map((r) => ({
        wallet: r.wallet as `0x${string}`,
        amount: parseUnits(r.amount.toString(), 6),
        handle: r.handle,
      })),
      params.strategyId,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  return depositHash;
}
