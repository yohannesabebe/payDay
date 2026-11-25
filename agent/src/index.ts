import express from "express";
import cors from "cors";
import { AGENT_CONFIG, CONTRACTS, QDAY_TESTNET } from "./config";
import { store } from "./store";
import { parseCsvPayroll, processChatMessage } from "./agent/nlp";
import { startAutonomousAgent, runExecutionCycle, runApyMonitorCycle } from "./agent/cron";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    network: QDAY_TESTNET.name,
    chainId: QDAY_TESTNET.id,
    onChainConfigured: Boolean(CONTRACTS.router && CONTRACTS.vault && CONTRACTS.registry),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    network: QDAY_TESTNET,
    contracts: CONTRACTS,
  });
});

app.get("/api/strategies", (_req, res) => {
  res.json({ strategies: store.getStrategies() });
});

app.get("/api/payrolls", (req, res) => {
  const employer = typeof req.query.employer === "string" ? req.query.employer : undefined;
  res.json({ payrolls: store.listPayrolls(employer) });
});

app.post("/api/payrolls", (req, res) => {
  const { employer, principal, payrollDate, strategyId, recipients, txHash, mode } = req.body || {};
  if (!employer || !principal || !payrollDate || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "Missing required payroll fields" });
    return;
  }
  const created = store.createPayroll({
    employer,
    principal: Number(principal),
    payrollDate: Number(payrollDate),
    strategyId: Number(strategyId ?? store.getBestStrategy().id),
    recipients,
    txHash,
    mode: mode === "onchain" ? "onchain" : "simulation",
  });
  res.status(201).json({ payroll: created });
});

app.post("/api/payrolls/:id/execute", async (req, res) => {
  const id = Number(req.params.id);
  const { txHash } = req.body || {};
  const updated = store.executePayroll(id, txHash);
  if (!updated) {
    res.status(400).json({ error: "Payroll not found, already settled, or blocked by session guardrail" });
    return;
  }
  res.json({ payroll: updated });
});

app.post("/api/payrolls/:id/rebalance", (req, res) => {
  const id = Number(req.params.id);
  const { toStrategyId } = req.body || {};
  const updated = store.rebalancePayroll(id, Number(toStrategyId), "Manual/Agent APY optimization");
  if (!updated) {
    res.status(400).json({ error: "Unable to rebalance payroll" });
    return;
  }
  res.json({ payroll: updated });
});

app.post("/api/payrolls/:id/cancel", (req, res) => {
  const id = Number(req.params.id);
  const updated = store.cancelPayroll(id);
  if (!updated) {
    res.status(400).json({ error: "Payroll not found or already settled" });
    return;
  }
  res.json({ payroll: updated });
});

// Confirmation of Payee (.qday) endpoints
app.get("/api/cop/list", (_req, res) => {
  res.json({ payees: store.listPayees() });
});

app.get("/api/cop/resolve", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const found = store.resolvePayee(q);
  if (!found) {
    res.status(404).json({ error: "Payee handle or wallet not found" });
    return;
  }
  res.json({ payee: found });
});

app.post("/api/cop/register", (req, res) => {
  const { handle, wallet, displayName, verified } = req.body || {};
  if (!handle || !wallet || !displayName) {
    res.status(400).json({ error: "handle, wallet, and displayName are required" });
    return;
  }
  const entry = store.registerPayee(handle, wallet, displayName, verified ?? true);
  res.status(201).json({ payee: entry });
});

// Scoped Agent Session Guardrails
app.get("/api/sessions/:employer", (req, res) => {
  const session = store.getSession(req.params.employer);
  res.json({ session: session || null });
});

app.post("/api/sessions", (req, res) => {
  const { employer, budgetCap, durationSeconds } = req.body || {};
  if (!employer || !budgetCap || !durationSeconds) {
    res.status(400).json({ error: "employer, budgetCap, durationSeconds required" });
    return;
  }
  const session = store.upsertSession(employer, Number(budgetCap), Number(durationSeconds));
  res.json({ session });
});

app.post("/api/sessions/revoke", (req, res) => {
  const { employer } = req.body || {};
  if (!employer) {
    res.status(400).json({ error: "employer required" });
    return;
  }
  const session = store.revokeSession(employer);
  res.json({ session: session || null });
});

// Agent status, logs & manual triggers
app.get("/api/agent/status", (_req, res) => {
  res.json({
    erc8004AgentId: 1,
    agentName: "PayDay Autonomous Treasury Agent v1",
    reputationScore: 98,
    logs: store.getLogs(50),
  });
});

app.post("/api/agent/tick", async (_req, res) => {
  await runExecutionCycle();
  runApyMonitorCycle();
  res.json({ ok: true, logs: store.getLogs(20) });
});

// Natural language chat & CSV upload
app.post("/api/chat", async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const response = await processChatMessage(message);
  res.json(response);
});

app.post("/api/csv/parse", (req, res) => {
  const { csv, daysUntilPayday } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    res.status(400).json({ error: "csv text is required" });
    return;
  }
  const { recipients, warnings } = parseCsvPayroll(csv);
  if (recipients.length === 0) {
    res.status(400).json({ error: "No valid recipients found in CSV", warnings });
    return;
  }
  const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
  const days = Math.max(1, Number(daysUntilPayday || 7));
  const payrollDate = Math.floor(Date.now() / 1000) + days * 86400;
  const best = store.getBestStrategy();

  res.json({
    proposal: {
      totalAmount,
      payrollDate,
      payrollDateLabel: `in ${days} day(s)`,
      strategyId: best.id,
      strategyName: best.name,
      estimatedApyBps: best.apyBps,
      recipients,
      warnings,
    },
  });
});

app.listen(AGENT_CONFIG.port, () => {
  console.log(`[PayDay Agent] Server listening on http://localhost:${AGENT_CONFIG.port}`);
  startAutonomousAgent();
});
