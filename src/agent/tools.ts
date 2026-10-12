import { z } from "zod";
import type { Db } from "../db/index.js";
import { getBalance } from "../ledger/index.js";
import { propose } from "../pending/index.js";
import { getHistory } from "../transactions/index.js";

export interface ToolContext {
  db: Db;
  sessionId: string;
  accountId: number;
}

const Id = z.number().int().positive();

/** The model's whole surface (ADR-0002). Nothing here imports `ledger.transfer`. */
const TOOLS = {
  get_balance: {
    description: "Get the user's own account balance in cents.",
    args: z.object({}).strict(),
    run: (c: ToolContext) => ({ balanceCents: getBalance(c.db, c.accountId) }),
  },
  get_history: {
    description: "Get the user's recent transactions, newest first.",
    args: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    run: (c: ToolContext, a: { limit?: number }) => ({
      transactions: getHistory(c.db, c.accountId, a.limit ?? 10).map((t) => ({
        ...t,
        direction: t.fromAccountId === c.accountId ? "sent" : "received",
      })),
    }),
  },
  find_account: {
    description:
      "Find recipient accounts by (part of) a username. Returns all candidates; if more than one, ask the user to choose.",
    args: z.object({ query: z.string().trim().min(1).max(50) }).strict(),
    run: (c: ToolContext, a: { query: string }) => ({
      candidates: c.db
        .prepare(
          "SELECT a.id AS accountId, u.username FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id <> ? AND instr(lower(u.username), lower(?)) > 0 ORDER BY u.username",
        )
        .all(c.accountId, a.query),
    }),
  },
  propose_transfer: {
    description:
      "Propose a transfer from the user's account. Only creates a pending request; the user must press Confirm in the UI. Use an accountId returned by find_account. Amount is in integer cents (SGD 10.00 = 1000).",
    args: z.object({ toAccountId: Id, amountCents: Id }).strict(),
    run: (c: ToolContext, a: { toAccountId: number; amountCents: number }) => {
      if (a.toAccountId === c.accountId) return { ok: false, error: "same_account" };
      const exists = c.db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(a.toAccountId);
      if (!exists) return { ok: false, error: "unknown_account" };
      const p = propose(c.db, { sessionId: c.sessionId, accountId: c.accountId, ...a });
      return { pendingId: p.id, replacedEarlierRequest: p.replaced, status: "awaiting_user_confirmation" };
    },
  },
};

export type ToolResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; detail?: string };

/** OpenAI-format tool definitions for the gateway. */
export const toolDefinitions = Object.entries(TOOLS).map(([name, t]) => ({
  type: "function" as const,
  function: { name, description: t.description, parameters: z.toJSONSchema(t.args) },
}));

/** Validates name and raw JSON args, then runs the tool. `invalid` marks model errors (for the one re-prompt). */
export function runTool(c: ToolContext, name: string, rawArgs: string): { result: ToolResult; invalid: boolean } {
  const tool = (TOOLS as Record<string, (typeof TOOLS)[keyof typeof TOOLS]>)[name];
  if (!Object.hasOwn(TOOLS, name) || !tool) return { result: { ok: false, error: "unknown_tool" }, invalid: true };
  let json: unknown;
  try {
    json = JSON.parse(rawArgs || "{}");
  } catch {
    return { result: { ok: false, error: "invalid_arguments", detail: "arguments are not valid JSON" }, invalid: true };
  }
  const parsed = tool.args.safeParse(json);
  if (!parsed.success) {
    return { result: { ok: false, error: "invalid_arguments", detail: z.prettifyError(parsed.error) }, invalid: true };
  }
  const out = (tool.run as (c: ToolContext, a: unknown) => Record<string, unknown>)(c, parsed.data);
  return { result: ("ok" in out ? out : { ok: true, ...out }) as ToolResult, invalid: false };
}
