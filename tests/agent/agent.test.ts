import { describe, expect, it } from "vitest";
import { chat, type LlmDeps } from "../../src/agent/llm.js";
import { runTool, type ToolContext } from "../../src/agent/tools.js";
import { login } from "../../src/auth/index.js";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { getBalance } from "../../src/ledger/index.js";
import { getActive } from "../../src/pending/index.js";

function setup() {
  const db = openDb();
  seed(db);
  const s = login(db, "alice", "demo1234");
  if (!s.ok) throw new Error("login");
  const ctx: ToolContext = { db, sessionId: s.sessionId, accountId: s.accountId };
  return { db, ctx };
}

const call = (name: string, args: unknown, id = "c1") => ({
  id,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const reply = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }));

/** Scripted gateway: each entry is a Response or an Error to throw. */
function deps(script: (Response | Error)[]) {
  const sleeps: number[] = [];
  let calls = 0;
  const d: LlmDeps = {
    baseUrl: "http://x",
    apiKey: "k",
    model: "m",
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async () => {
      calls++;
      const r = script.shift();
      if (!r) throw new Error("script exhausted");
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { d, sleeps, calls: () => calls };
}

describe("tools", () => {
  it("balance, history and find_account read only", () => {
    const { ctx } = setup();
    expect(runTool(ctx, "get_balance", "{}").result).toEqual({ ok: true, balanceCents: 100_000 });
    expect(runTool(ctx, "get_history", "{}").result).toMatchObject({ ok: true, transactions: [] });
    const found = runTool(ctx, "find_account", '{"query":"B"}').result as unknown as { candidates: { username: string }[] };
    expect(found.candidates.map((c) => c.username)).toEqual(["bob"]); // excludes self, case-insensitive
  });

  it("propose_transfer only writes the pending row", () => {
    const { db, ctx } = setup();
    const { result } = runTool(ctx, "propose_transfer", '{"toAccountId":2,"amountCents":500}');
    expect(result).toMatchObject({ ok: true, status: "awaiting_user_confirmation" });
    expect(getActive(db, ctx.sessionId)).toMatchObject({ toAccountId: 2, amountCents: 500 });
    expect(getBalance(db, 1)).toBe(100_000);
    expect(getBalance(db, 2)).toBe(100_000);
  });

  it.each([
    ["propose_transfer", "not json"],
    ["propose_transfer", '{"toAccountId":2,"amountCents":-5}'],
    ["propose_transfer", '{"toAccountId":2,"amountCents":1.5}'],
    ["propose_transfer", '{"toAccountId":2}'],
    ["propose_transfer", '{"toAccountId":2,"amountCents":5,"extra":1}'],
    ["transfer", "{}"],
    ["constructor", "{}"],
  ])("rejects invalid call %s %s", (name, args) => {
    const { db, ctx } = setup();
    const r = runTool(ctx, name, args);
    expect(r.invalid).toBe(true);
    expect(r.result.ok).toBe(false);
    expect(getActive(db, ctx.sessionId)).toBeUndefined();
  });

  it("business errors are explained, not flagged invalid", () => {
    const { ctx } = setup();
    expect(runTool(ctx, "propose_transfer", '{"toAccountId":1,"amountCents":5}')).toEqual({
      result: { ok: false, error: "same_account" },
      invalid: false,
    });
    expect(runTool(ctx, "propose_transfer", '{"toAccountId":99,"amountCents":5}').result).toEqual({
      ok: false,
      error: "unknown_account",
    });
  });
});

describe("chat", () => {
  it("runs tool calls then returns the final reply", async () => {
    const { db, ctx } = setup();
    const { d } = deps([
      reply({ tool_calls: [call("propose_transfer", { toAccountId: 2, amountCents: 1000 })] }),
      reply({ content: "Please confirm sending SGD 10.00 to bob." }),
    ]);
    const r = await chat(d, ctx, "send bob $10");
    expect(r).toMatchObject({ ok: true, reply: "Please confirm sending SGD 10.00 to bob." });
    expect(getActive(db, ctx.sessionId)?.amountCents).toBe(1000);
    expect(getBalance(db, 1)).toBe(100_000);
  });

  it("retries network/5xx errors up to 3 attempts with backoff, then gives up", async () => {
    const { ctx } = setup();
    const { d, sleeps, calls } = deps([new Error("net"), new Response("x", { status: 503 }), new Error("net")]);
    expect(await chat(d, ctx, "hi")).toEqual({ ok: false, reason: "llm_unavailable" });
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([200, 400]);
  });

  it("recovers when a retry succeeds", async () => {
    const { ctx } = setup();
    const { d, calls } = deps([new Error("net"), reply({ content: "hello" })]);
    expect(await chat(d, ctx, "hi")).toMatchObject({ ok: true, reply: "hello" });
    expect(calls()).toBe(2);
  });

  it("does not retry 429", async () => {
    const { ctx } = setup();
    const { d, calls } = deps([new Response("{}", { status: 429 })]);
    expect(await chat(d, ctx, "hi")).toEqual({ ok: false, reason: "rate_limited" });
    expect(calls()).toBe(1);
  });

  it("re-prompts one invalid tool call, abandons the second", async () => {
    const { db, ctx } = setup();
    const bad = () => reply({ tool_calls: [call("propose_transfer", { toAccountId: 2 })] });
    const ok = deps([bad(), reply({ content: "Sorry, how much?" })]);
    expect(await chat(ok.d, ctx, "send bob money")).toMatchObject({ ok: true, reply: "Sorry, how much?" });

    const abandoned = deps([bad(), bad()]);
    expect(await chat(abandoned.d, ctx, "send bob money")).toEqual({ ok: false, reason: "invalid_tool_call" });
    expect(getActive(db, ctx.sessionId)).toBeUndefined();
  });

  it("stops a model that never finishes", async () => {
    const { ctx } = setup();
    const loop = Array.from({ length: 10 }, () => reply({ tool_calls: [call("get_balance", {})] }));
    expect(await chat(deps(loop).d, ctx, "hi")).toEqual({ ok: false, reason: "too_many_steps" });
  });
});
