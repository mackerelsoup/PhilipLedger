import { z } from "zod";
import type { Db } from "../db/index.js";
import { accountExists, findAccounts, getBalance } from "../ledger/index.js";
import { propose } from "../pending/index.js";
import { getHistory } from "../transactions/index.js";

export interface ToolContext {
  db: Db;
  sessionId: string;
  accountId: number;
}

const sgd = (cents: number) => `${cents < 0 ? "-" : ""}SGD ${(Math.abs(cents) / 100).toFixed(2)}`;
const sgt = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
/** Stored timestamps are UTC ISO strings; the model only ever sees Singapore time. */
const toSgt = (iso: string) => `${sgt.format(new Date(iso))} SGT`;
const Id = z.number().int().positive();

/** Every tool returns this same envelope: exactly one of `data` / `error` is non-null. */
export type ToolResult =
  | { ok: true; data: Record<string, unknown>; error: null }
  | { ok: false; data: null; error: { code: string; detail: string | null } };

const success = (data: Record<string, unknown>): ToolResult => ({ ok: true, data, error: null });
const failure = (code: string, detail: string | null = null): ToolResult => ({ ok: false, data: null, error: { code, detail } });

/** The model's whole surface (ADR-0002). Nothing here imports `ledger.transfer`. */
const TOOLS = {
  get_balance: {
    description: "Get the user's own account balance in cents.",
    args: z.object({}).strict(),
    run: (c: ToolContext) => {
      const balanceCents = getBalance(c.db, c.accountId) ?? 0;
      return success({ balanceCents, balance: sgd(balanceCents) });
    },
  },
  get_history: {
    description: "Get the user's recent transactions, newest first.",
    args: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    run: (c: ToolContext, a: { limit?: number }) =>
      success({
        transactions: getHistory(c.db, c.accountId, a.limit ?? 10).map((t) => ({
          ...t,
          createdAt: toSgt(t.createdAt),
          amount: sgd(t.amountCents),
          direction: t.fromAccountId === c.accountId ? "sent" : "received",
        })),
      }),
  },
  find_account: {
    description:
      "Find recipient accounts by (part of) a username. Returns all candidates; if more than one, ask the user to choose.",
    args: z.object({ query: z.string().trim().min(1).max(50) }).strict(),
    run: (c: ToolContext, a: { query: string }) =>
      success({ candidates: findAccounts(c.db, a.query, c.accountId) }),
  },
  propose_transfer: {
    description:
      "Propose a transfer from the user's account. Only creates a pending request; the user must press Confirm in the UI. Use an accountId returned by find_account. Amount is in integer cents (SGD 10.00 = 1000).",
    args: z.object({ toAccountId: Id, amountCents: Id }).strict(),
    run: (c: ToolContext, a: { toAccountId: number; amountCents: number }) => {
      if (a.toAccountId === c.accountId) return failure("same_account");
      if (!accountExists(c.db, a.toAccountId)) return failure("unknown_account");
      const p = propose(c.db, { sessionId: c.sessionId, accountId: c.accountId, ...a });
      return success({ pendingId: p.id, replacedEarlierRequest: p.replaced, status: "awaiting_user_confirmation" });
    },
  },
};

/** OpenAI-format tool definitions for the gateway. */
export const toolDefinitions = Object.entries(TOOLS).map(([name, t]) => ({
  type: "function" as const,
  function: { name, description: t.description, parameters: z.toJSONSchema(t.args) },
}));

/** Validates name and raw JSON args, then runs the tool. `invalid` marks model errors (for the one re-prompt). */
export function runTool(c: ToolContext, name: string, rawArgs: string): { result: ToolResult; invalid: boolean } {
  const bad = (code: string, detail?: string) => ({ result: failure(code, detail), invalid: true });
  if (!Object.hasOwn(TOOLS, name)) return bad("unknown_tool");
  const tool = TOOLS[name as keyof typeof TOOLS];
  let json: unknown;
  try {
    json = JSON.parse(rawArgs || "{}");
  } catch {
    return bad("invalid_arguments", "arguments are not valid JSON");
  }
  const parsed = tool.args.safeParse(json);
  if (!parsed.success) return bad("invalid_arguments", z.prettifyError(parsed.error));
  try {
    return { result: (tool.run as (c: ToolContext, a: unknown) => ToolResult)(c, parsed.data), invalid: false };
  } catch (e) {
    console.error(`tool ${name} failed`, e);
    return { result: failure("internal_error"), invalid: false };
  }
}
