# PayDay — Autonomous Yield-Optimized Payroll on QDay Aevum

> Built for **Aevum Builder Challenge #1** (QDay Aevum Testnet · Chain ID `44005`)  
> Tracks: **Payroll and Vesting**, **Confirmation of Payee**, **Native AI Assistants**, **Decentralized Payments**

**PayDay** transforms idle corporate payroll reserves into yield-generating capital on **QDay Aevum Testnet** (`tUSD8`) before payday. Employers schedule payrolls in plain English or via CSV upload, verify recipients through an on-chain **ERC-8004 & Confirmation of Payee (`.qday`) Registry**, and grant **least-privilege scoped agent sessions** with hard budget caps and instant revocation.

On payday, the **PayDay Autonomous Agent** withdraws the principal + accrued DeFi yield, **returns 100% of earned yield to the employer**, and **distributes the exact salary principal to all employees in `tUSD8`**.

---

## Architecture

```
+-------------------------------------------------------------------+
|                   PayDay React Frontend (Vite)                    |
|  - Natural Language AI Payroll Chat & CSV Batch Upload            |
|  - QDay Aevum Wallet Connect (Chain 44005 / tUSD8) + Demo Mode    |
|  - Live Yield Dashboard & Scoped Agent Session Kill Switch        |
+---------------------------------+---------------------------------+
                                  | REST API
                                  v
+-------------------------------------------------------------------+
|                 PayDay Autonomous Agent (Node/TS)                 |
|  - Execution Loop: Detects payday reached & settles payrolls      |
|  - APY Monitor: Rebalances idle capital to highest-APY QDay pool  |
|  - CoP & NLP Engine: Resolves .qday handles + injection guardrails|
+---------------------------------+---------------------------------+
                                  | viem / JSON-RPC
                                  v
+-------------------------------------------------------------------+
|               QDay Aevum Testnet (Chain ID: 44005)                |
|  +----------------------+   +----------------------------------+  |
|  | PayDayRouter.sol     |-->| PayDayYieldVault.sol             |  |
|  | - createPayroll()    |   | - QDay Stable LP (8.50% APY)     |  |
|  | - executePayroll()   |   | - Aevum Treasury Pool (14.20%)   |  |
|  | - cancelPayroll()    |   | - Quantum Liquidity Pool (21.0%) |  |
|  | - Scoped Sessions    |   +----------------------------------+  |
|  +----------+-----------+                                         |
|             |                                                     |
|             v                                                     |
|  +-------------------------------------------------------------+  |
|  | ERC8004PayeeRegistry.sol                                    |  |
|  | - ERC-8004 Agent Identity NFT & Reputation (0-100)          |  |
|  | - Confirmation of Payee (.qday -> wallet, name, verified)   |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

## QDay Aevum Testnet Configuration

| Parameter | Value |
|---|---|
| **Network Name** | QDay Aevum Testnet |
| **Chain ID** | `44005` |
| **RPC URL** | `https://rpc-test.qday.info` |
| **WebSocket** | `wss://rpc-test.qday.info` |
| **Native Gas Token** | `tQDAY` |
| **Block Explorer** | https://explorer-test.qday.info/ |
| **Faucet** | https://faucet.qday.info/en |
| **`tUSD8` Stablecoin (6 decimals)** | `0x456569838f1d43009A91ebA4263147Afd7233483` |

---

## Core Features & Safety Guardrails

1. **Idle Capital Yield Generation (`PayDayYieldVault.sol`)**
   - Deposited `tUSD8` is deployed into QDay yield pools (`8.5%` – `21.0%` APY) until `payrollDate`.
   - On payday, 100% of accrued yield is returned to the employer while 100% of principal is distributed to employees.
   - Principal protection: yield payouts are capped by `yieldReserve` so employee principal is never at risk.
2. **Confirmation of Payee & ERC-8004 Registry (`ERC8004PayeeRegistry.sol`)**
   - Resolves human-readable `.qday` handles (e.g., `alice.qday`, `bob.qday`) to verified wallet addresses and legal names before locking funds.
   - Mints an ERC-8004 Identity NFT for the autonomous agent and tracks on-chain reputation feedback.
3. **Least-Privilege Scoped Agent Sessions (`PayDayRouter.sol`)**
   - Employers grant scoped sessions with a hard `budgetCap` (max `tUSD8` per payroll) and `expiry` timestamp.
   - Employers can **revoke the agent session** or **emergency-cancel a payroll** at any time to withdraw principal + accrued yield immediately.
4. **Autonomous Agent & Natural Language / CSV UX**
   - Works out of the box with a built-in deterministic NLP parser (and optional `OPENAI_API_KEY`).
   - Includes prompt-injection guardrails and CSV batch import (`sample_employees.csv` provided).

---

## Quick Start (Local Development & Testing)

### Prerequisites
- Node.js `>= 20` and npm

### 1. Compile & Test Smart Contracts
```bash
cd contracts
npm install
npx hardhat test
```

### 2. (Optional) Deploy Contracts to QDay Aevum Testnet
```bash
cp contracts/.env.example contracts/.env
# Add your funded QDay Testnet DEPLOYER_PRIVATE_KEY to contracts/.env
cd contracts
npm run deploy:testnet
```
This writes `contracts/deployments.json`, which the Agent backend automatically loads.

### 3. Start the Autonomous Agent & API Server
```bash
cd agent
npm install
cp .env.example .env
npm run dev
```
Runs at `http://localhost:3001`.

### 4. Start the React Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. You can test immediately in **Demo Mode** or click **Connect QDay Wallet** to switch MetaMask to **QDay Aevum Testnet (Chain ID 44005)** and transact with `tUSD8`.

---

## API Reference (`agent/`)

- `GET /api/health` — Server & QDay network status
- `GET /api/strategies` — Available QDay yield strategies and APYs
- `GET /api/payrolls` — List payrolls with live accrued yield
- `POST /api/payrolls` — Record/create a payroll position
- `POST /api/payrolls/:id/execute` — Execute payroll & distribute principal + return yield
- `POST /api/payrolls/:id/rebalance` — Rebalance payroll to higher-APY strategy
- `POST /api/payrolls/:id/cancel` — Employer emergency cancel
- `GET /api/cop/list` & `POST /api/cop/register` — Confirmation of Payee (`.qday`) directory
- `POST /api/sessions` & `POST /api/sessions/revoke` — Scoped agent session guardrails
- `POST /api/chat` & `POST /api/csv/parse` — Natural language & CSV payroll builder

---

## Known Assumptions & Roadmap

- **Yield Reserve Model**: On testnet, `PayDayYieldVault` uses deterministic time-accrued yield backed by `yieldReserve` (funded via `fundYieldReserve`) so behavior is 100% reproducible without external DEX liquidity volatility. Mainnet roadmap integrates native QDay AMM / money-market adapters.
- **Account Abstraction (ERC-4337)**: Future milestone adds gasless `tUSD8` paymaster sponsorship so employers and employees never need `tQDAY` for gas.
