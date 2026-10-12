import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../../src/api/router.js";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { getBalance } from "../../src/ledger/index.js";

let server: Server;
afterEach(() => new Promise((r) => server.close(r)));

async function start() {
  const db = openDb();
  seed(db);
  db.prepare(
    "INSERT INTO pending_operations (id, account_id, to_account_id, amount_cents, state, expires_at) VALUES ('p1', 1, 2, 1000, 'awaiting_confirmation', ?)",
  ).run(new Date(Date.now() + 60_000).toISOString());
  // stand-in for auth (build step 3): the x-account header is the caller's account id
  server = createApi(db, (req) => Number(req.headers["x-account"]) || undefined);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const post = async (path: string, account?: number) => {
    const res = await fetch(base + path, { method: "POST", headers: account ? { "x-account": String(account) } : {} });
    return { status: res.status, body: await res.json() };
  };
  return { db, post };
}

describe("api router", () => {
  it("confirm executes; a repeat press returns 200 with the same transaction", async () => {
    const { db, post } = await start();
    const first = await post("/pending/p1/confirm", 1);
    const second = await post("/pending/p1/confirm", 1);
    expect(first).toMatchObject({ status: 200, body: { ok: true, replayed: false } });
    expect(second).toMatchObject({ status: 200, body: { ok: true, replayed: true } });
    expect(second.body.transaction).toEqual(first.body.transaction);
    expect(getBalance(db, 1)).toBe(99_000);
  });

  it("401 without a caller, 404 for another user's op, 404 for unknown route", async () => {
    const { db, post } = await start();
    expect((await post("/pending/p1/confirm")).status).toBe(401);
    expect((await post("/pending/p1/confirm", 2)).status).toBe(404);
    expect((await post("/nope", 1)).status).toBe(404);
    expect(getBalance(db, 1)).toBe(100_000);
  });

  it("reject clears the op; confirming afterwards is 404", async () => {
    const { post } = await start();
    expect((await post("/pending/p1/reject", 1)).status).toBe(200);
    expect((await post("/pending/p1/confirm", 1)).status).toBe(404);
  });

  it("maps failures: insufficient funds 409", async () => {
    const { db, post } = await start();
    db.prepare("UPDATE pending_operations SET amount_cents = 999999").run();
    expect(await post("/pending/p1/confirm", 1)).toMatchObject({ status: 409, body: { ok: false, reason: "insufficient_funds" } });
  });
});

describe("ui routes", () => {
  it("serves the page, logs in, and chat returns the pending op for the Confirm button", async () => {
    const { accountOfSession } = await import("../../src/auth/index.js");
    const { bearer } = await import("../../src/api/router.js");
    const db = openDb();
    seed(db);
    const llm = {
      baseUrl: "http://x",
      apiKey: "k",
      model: "m",
      sleep: async () => {},
      fetch: (async () => {
        const n = (llm as { n?: number }).n ?? 0;
        (llm as { n?: number }).n = n + 1;
        const message = n === 0
          ? { tool_calls: [{ id: "c", function: { name: "propose_transfer", arguments: '{"toAccountId":2,"amountCents":500}' } }] }
          : { content: "Confirm?" };
        return new Response(JSON.stringify({ choices: [{ message }] }));
      }) as typeof fetch,
    };
    server = createApi(db, (req) => accountOfSession(db, bearer(req)), llm);
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const json = (path: string, body: object, token?: string) =>
      fetch(base + path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

    expect((await fetch(base + "/")).headers.get("content-type")).toContain("text/html");
    expect((await json("/login", { username: "alice", password: "wrong" })).status).toBe(401);
    expect((await json("/chat", { text: "hi" })).status).toBe(401);
    const { body: login } = await json("/login", { username: "alice", password: "demo1234" });
    const chatRes = await json("/chat", { text: "send bob 5" }, login.sessionId);
    expect(chatRes.body).toMatchObject({ ok: true, reply: "Confirm?", pending: { to: "bob", amountCents: 500 } });
    expect(getBalance(db, 1)).toBe(100_000);
    const done = await json(`/pending/${chatRes.body.pending.id}/confirm`, {}, login.sessionId);
    expect(done.body).toMatchObject({ ok: true });
    expect(getBalance(db, 2)).toBe(100_500);
  });
});
