import { cancel } from "../pending/index.js";
import type { ToolContext } from "./tools.js";
import { runTool, toolDefinitions } from "./tools.js";

export interface LlmDeps {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type Message = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; function: { name: string; arguments: string } };

export type ChatResult =
  | { ok: true; reply: string; history: Message[] }
  | { ok: false; reason: "rate_limited" | "llm_unavailable" | "invalid_tool_call" | "too_many_steps" };

const SYSTEM = `You are a ledger assistant for one user. You can check their balance, show history, list who they can send to, find recipients and propose transfers.
You cannot move money: propose_transfer only creates a request the user must confirm with the Confirm button. Never claim a transfer is done.
Never guess a recipient: call find_account, and if there is more than one candidate list them and ask the user to choose. Ask for any missing amount or recipient. Amounts are SGD; tool amounts are integer cents and tool results also give a ready-made "SGD x.xx" string: quote that, never convert cents yourself.
Be brief: answer only what was asked, with no offers, follow-up questions or filler unless information is missing.
Only state facts that appear in tool results from this turn. Before saying anything about the balance or whether a transfer happened, call get_balance and get_history this turn, and report only what they show. When listing transactions, show each one's counterparty (who it was sent to or received from), amount and time. Never speculate (e.g. about delays or reconciling); if the results look inconsistent, say exactly what they show.
Every tool returns {ok, data, error}. On success read the fields under data; on failure error.code says why (e.g. same_account, unknown_account) and you should explain it plainly.`;

const MAX_ATTEMPTS = 3;
const MAX_STEPS = 6;
const BACKOFF_MS = 200;

class Fail extends Error {
  constructor(readonly reason: "rate_limited" | "llm_unavailable") {
    super(reason);
  }
}

/** One completion call. Network/5xx retried up to 3x with backoff; 429 and other 4xx are not (ADR-0005). */
async function complete(d: LlmDeps, messages: Message[]): Promise<{ content?: string | null; tool_calls?: ToolCall[] }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await (d.fetch ?? fetch)(`${d.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${d.apiKey}` },
        body: JSON.stringify({ model: d.model, messages, tools: toolDefinitions }),
      });
      if (res.status === 429) throw new Fail("rate_limited");
      if (res.status >= 400 && res.status < 500) throw new Fail("llm_unavailable");
      if (!res.ok) throw new Error(`gateway ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: Message }[] };
      const msg = body.choices?.[0]?.message;
      if (!msg) throw new Error("empty completion");
      return msg;
    } catch (e) {
      if (e instanceof Fail) throw e;
      if (attempt >= MAX_ATTEMPTS) throw new Fail("llm_unavailable");
      await (d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * One user turn: tool-calling loop. An invalid tool call is re-prompted once with the error,
 * a second one abandons the turn. Pass the returned `history` back in to continue the chat.
 */
export async function chat(
  d: LlmDeps,
  ctx: ToolContext,
  text: string,
  history: Message[] = [],
): Promise<ChatResult> {
  const messages: Message[] = [...history, { role: "user", content: text }];
  let invalids = 0;
  let proposed: string | undefined;
  // A failed turn changes nothing (ADR-0005): undo a proposal made earlier in the same turn.
  const fail = (reason: Extract<ChatResult, { ok: false }>["reason"]): ChatResult => {
    if (proposed) cancel(ctx.db, proposed);
    return { ok: false, reason };
  };
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const msg = await complete(d, [{ role: "system", content: SYSTEM }, ...messages]);
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
      if (!msg.tool_calls?.length) return { ok: true, reply: msg.content ?? "", history: messages };
      for (const call of msg.tool_calls) {
        const { result, invalid } = runTool(ctx, call.function.name, call.function.arguments);
        if (result.ok && typeof result.data.pendingId === "string") proposed = result.data.pendingId;
        if (invalid && ++invalids > 1) return fail("invalid_tool_call");
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return fail("too_many_steps");
  } catch (e) {
    if (e instanceof Fail) return fail(e.reason);
    throw e;
  }
}
