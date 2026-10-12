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
