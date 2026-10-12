import { describe, expect, it } from "vitest";
import { confirm, reject } from "../../src/api/confirm.js";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { getBalance } from "../../src/ledger/index.js";
import { getHistory } from "../../src/transactions/index.js";

const NOW = new Date("2026-01-01T00:00:00Z");
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

function setup() {
  const db = openDb();
  seed(db);
  const pend = (id: string, o: Record<string, unknown> = {}) => {
    const p = { id, accountId: 1, toAccountId: 2, amountCents: 1000, state: "awaiting_confirmation", expiresAt: minutes(5), ...o };
    db.prepare(
      "INSERT INTO pending_operations (id, account_id, to_account_id, amount_cents, state, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(p.id, p.accountId, p.toAccountId, p.amountCents, p.state, p.expiresAt);
  };
  const count = () => (db.prepare("SELECT COUNT(*) c FROM pending_operations").get() as { c: number }).c;
  return { db, pend, count };
}

describe("confirm", () => {
  it("executes the transfer and consumes the pending op", () => {
    const { db, pend, count } = setup();
    pend("p1");
    const r = confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    expect(r).toMatchObject({ ok: true, replayed: false, transaction: { amountCents: 1000, idempotencyKey: "p1" } });
    expect(getBalance(db, 1)).toBe(99_000);
    expect(getBalance(db, 2)).toBe(101_000);
    expect(count()).toBe(0);
  });

  it("double-confirm returns the original result and moves money once", () => {
    const { db, pend } = setup();
    pend("p1");
    const first = confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    const second = confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(second.ok && first.ok && second.transaction).toEqual(first.ok && first.transaction);
    expect(getBalance(db, 1)).toBe(99_000);
    expect(getHistory(db, 1)).toHaveLength(1);
  });

  it("replay still works after the pending op would have expired", () => {
    const { db, pend } = setup();
    pend("p1");
    confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    const r = confirm(db, { pendingId: "p1", accountId: 1, now: new Date(NOW.getTime() + 3_600_000) });
    expect(r).toMatchObject({ ok: true, replayed: true });
  });

  it("insufficient funds: fails, moves nothing, keeps the pending op", () => {
    const { db, pend, count } = setup();
    pend("p1", { amountCents: 100_001 });
    expect(confirm(db, { pendingId: "p1", accountId: 1, now: NOW })).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(getBalance(db, 1)).toBe(100_000);
    expect(getHistory(db, 1)).toHaveLength(0);
    expect(count()).toBe(1);
  });

  it("expired pending op: fails, moves nothing, is cleared", () => {
    const { db, pend, count } = setup();
    pend("p1");
    const r = confirm(db, { pendingId: "p1", accountId: 1, now: new Date(minutes(5)) }); // exactly at expiry
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect(getBalance(db, 1)).toBe(100_000);
    expect(count()).toBe(0);
  });

  it("refuses a pending op that is still collecting details", () => {
    const { db, pend } = setup();
    pend("p1", { state: "collecting" });
    expect(confirm(db, { pendingId: "p1", accountId: 1, now: NOW })).toEqual({ ok: false, reason: "not_ready" });
    expect(getBalance(db, 1)).toBe(100_000);
  });

  it("unknown id and other users' ops look the same: not_found", () => {
    const { db, pend, count } = setup();
    pend("p1");
    expect(confirm(db, { pendingId: "nope", accountId: 1, now: NOW })).toEqual({ ok: false, reason: "not_found" });
    expect(confirm(db, { pendingId: "p1", accountId: 2, now: NOW })).toEqual({ ok: false, reason: "not_found" });
    expect(getBalance(db, 1)).toBe(100_000);
    expect(count()).toBe(1);
  });

  it("another user cannot replay someone else's executed transfer", () => {
    const { db, pend } = setup();
    pend("p1");
    confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    expect(confirm(db, { pendingId: "p1", accountId: 3, now: NOW })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("reject", () => {
  it("clears the pending op without moving money", () => {
    const { db, pend, count } = setup();
    pend("p1");
    expect(reject(db, { pendingId: "p1", accountId: 1 })).toEqual({ ok: true });
    expect(count()).toBe(0);
    expect(getBalance(db, 1)).toBe(100_000);
  });

  it("cannot reject after execution or someone else's op", () => {
    const { db, pend, count } = setup();
    pend("p1");
    pend("p2");
    confirm(db, { pendingId: "p1", accountId: 1, now: NOW });
    expect(reject(db, { pendingId: "p1", accountId: 1 })).toEqual({ ok: false, reason: "not_found" });
    expect(reject(db, { pendingId: "p2", accountId: 2 })).toEqual({ ok: false, reason: "not_found" });
    expect(count()).toBe(1);
  });
});
