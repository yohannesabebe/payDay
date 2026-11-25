import OpenAI from "openai";
import { AGENT_CONFIG } from "../config";
import { store, RecipientRecord } from "../store";

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

export interface ChatResponse {
  reply: string;
  proposal?: PayrollProposal;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /send\s+all\s+funds\s+to/i,
  /override\s+budget\s+cap/i,
];

export function parseCsvPayroll(csvText: string): { recipients: RecipientRecord[]; warnings: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const recipients: RecipientRecord[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /name|wallet|handle|amount/i.test(line)) continue; // skip header

    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;

    let name = "";
    let identifier = "";
    let amountStr = "";

    if (parts.length >= 3) {
      [name, identifier, amountStr] = parts;
    } else {
      [identifier, amountStr] = parts;
      name = identifier;
    }

    const amount = Number(amountStr.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      warnings.push(`Row ${i + 1}: invalid amount "${amountStr}"`);
      continue;
    }

    const resolved = store.resolvePayee(identifier);
    if (resolved) {
      recipients.push({
        wallet: resolved.wallet,
        handle: resolved.handle,
        displayName: resolved.displayName || name,
        amount,
        copVerified: resolved.verified,
      });
      if (!resolved.verified) {
        warnings.push(`Confirmation of Payee warning: ${resolved.handle} is not yet verified.`);
      }
    } else if (/^0x[a-fA-F0-9]{40}$/.test(identifier)) {
      recipients.push({
        wallet: identifier,
        handle: name || `${identifier.slice(0, 6)}...${identifier.slice(-4)}`,
        displayName: name || "Unregistered Address",
        amount,
        copVerified: false,
      });
      warnings.push(`Unverified raw address ${identifier.slice(0, 10)}... (not in .qday CoP directory).`);
    } else {
      warnings.push(`Could not resolve payee "${identifier}" in .qday Confirmation of Payee registry.`);
    }
  }

  return { recipients, warnings };
}

function parseDurationSeconds(text: string): { seconds: number; label: string } {
  const minMatch = text.match(/in\s+(\d+)\s*min(?:ute)?s?/i);
  if (minMatch) {
    const mins = Math.max(1, Number(minMatch[1]));
    return { seconds: mins * 60, label: `in ${mins} minute(s)` };
  }
  const hourMatch = text.match(/in\s+(\d+)\s*h(?:our)?s?/i);
  if (hourMatch) {
    const hrs = Math.max(1, Number(hourMatch[1]));
    return { seconds: hrs * 3600, label: `in ${hrs} hour(s)` };
  }
  const dayMatch = text.match(/in\s+(\d+)\s*d(?:ay)?s?/i);
  if (dayMatch) {
    const days = Math.max(1, Number(dayMatch[1]));
    return { seconds: days * 86400, label: `in ${days} day(s)` };
  }
  const weekMatch = text.match(/in\s+(\d+)\s*w(?:eek)?s?/i);
  if (weekMatch) {
    const wks = Math.max(1, Number(weekMatch[1]));
    return { seconds: wks * 7 * 86400, label: `in ${wks} week(s)` };
  }
  return { seconds: 7 * 86400, label: "in 7 days (default)" };
}

function deterministicParse(message: string): ChatResponse {
  // Guardrail: prompt injection check
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(message)) {
      store.addLog("GUARDRAIL", `Blocked suspicious prompt injection attempt: "${message.slice(0, 60)}..."`);
      return {
        reply:
          "Security Guardrail Triggered: That instruction looks like a policy override attempt. I can only prepare standard scoped payroll transactions for your explicit wallet signature.",
      };
    }
  }

  const lower = message.toLowerCase();

  // APY / Strategy inquiry
  if (/(apy|yield|strateg|rate|pool)/i.test(lower) && !/pay\s+/i.test(lower)) {
    const strategies = store.getStrategies();
    const lines = strategies.map(
      (s) => `- **${s.name}** (${s.protocol}): **${(s.apyBps / 100).toFixed(2)}% APY** · Risk: ${s.risk}`
    );
    return {
      reply: `Here are the live QDay Aevum yield strategies where your idle \`tUSD8\` payroll capital earns yield until payday:\n\n${lines.join(
        "\n"
      )}\n\nBy default, I select the highest-APY pool and automatically rebalance if a better rate opens up (>24h before payday).`,
    };
  }

  // Extract "pay <handle_or_address> <amount>" pairs
  const recipients: RecipientRecord[] = [];
  const warnings: string[] = [];
  const pairRegex = /([a-zA-Z0-9_.-]+\.qday|0x[a-fA-F0-9]{40})\s+(?:for\s+)?\$?([\d,]+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;

  while ((match = pairRegex.exec(message)) !== null) {
    const identifier = match[1];
    const amount = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const resolved = store.resolvePayee(identifier);
    if (resolved) {
      recipients.push({
        wallet: resolved.wallet,
        handle: resolved.handle,
        displayName: resolved.displayName,
        amount,
        copVerified: resolved.verified,
      });
      if (!resolved.verified) {
        warnings.push(`${resolved.handle} is registered but not yet CoP-verified.`);
      }
    } else if (/^0x[a-fA-F0-9]{40}$/.test(identifier)) {
      recipients.push({
        wallet: identifier,
        handle: `${identifier.slice(0, 6)}...${identifier.slice(-4)}`,
        displayName: "Raw Address",
        amount,
        copVerified: false,
      });
      warnings.push(`Raw address ${identifier.slice(0, 10)}... is not in the .qday Confirmation of Payee directory.`);
    } else {
      warnings.push(`Could not resolve "${identifier}" in Confirmation of Payee registry.`);
    }
  }

  if (recipients.length === 0) {
    return {
      reply:
        'I can set up a yield-generating `tUSD8` payroll for you! Try something like:\n\n> *"Pay alice.qday 2500 and bob.qday 3200 in 7 days"*\n\nOr upload a CSV file of employees using the **Upload CSV** button below.',
    };
  }

  const totalAmount = recipients.reduce((acc, r) => acc + r.amount, 0);
  const { seconds, label } = parseDurationSeconds(message);
  const payrollDate = Math.floor(Date.now() / 1000) + seconds;
  const best = store.getBestStrategy();

  const estimatedYield = (totalAmount * (best.apyBps / 10000) * seconds) / (365 * 86400);

  return {
    reply: `I've prepared your **PayDay Yield-Optimized Payroll** (${totalAmount.toLocaleString()} \`tUSD8\` across ${recipients.length} recipient(s), scheduled **${label}**).\n\nIdle funds will deploy into **${best.name}** at **${(best.apyBps / 100).toFixed(2)}% APY** (est. **+${estimatedYield.toFixed(4)} tUSD8** returned to you on payday). Review the Confirmation of Payee checks and sign below:`,
    proposal: {
      totalAmount,
      payrollDate,
      payrollDateLabel: label,
      strategyId: best.id,
      strategyName: best.name,
      estimatedApyBps: best.apyBps,
      recipients,
      warnings,
    },
  };
}

export async function processChatMessage(message: string): Promise<ChatResponse> {
  // Always run deterministic parser first to extract structured proposal & enforce guardrails
  const parsed = deterministicParse(message);
  if (parsed.proposal || !AGENT_CONFIG.openAiApiKey) {
    return parsed;
  }

  // Optional OpenAI conversational fallback when no structured payroll command matched
  try {
    const client = new OpenAI({ apiKey: AGENT_CONFIG.openAiApiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are PayDay AI, an autonomous payroll & treasury assistant on QDay Aevum Testnet (Chain ID 44005, stablecoin tUSD8). Keep replies concise and helpful. Remind users they can pay .qday handles, upload CSVs, and earn yield until payday.",
        },
        { role: "user", content: message },
      ],
      max_tokens: 250,
    });
    return {
      reply: completion.choices[0]?.message?.content || parsed.reply,
    };
  } catch {
    return parsed;
  }
}
