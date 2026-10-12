import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { getBalance as maybeBalance, transfer } from "../../src/ledger/index.js";
import { getHistory } from "../../src/transactions/index.js";

const setup = () => {
  const db = openDb();
  seed(db);
  return db;
};
const getBalance = (db: ReturnType<typeof setup>, id: number) => maybeBalance(db, id)!;
const total = (db: ReturnType<typeof setup>) =>
  (db.prepare("SELECT SUM(balance_cents) s FROM accounts").get() as { s: number }).s;

describe("ledger.transfer", () => {
  it("moves money and records a transaction", () => {
    const db = setup();
    const [a, b, sum] = [getBalance(db, 1), getBalance(db, 2), total(db)];
    const r = transfer(db, { fromAccountId: 1, toAccountId: 2, amountCents: 1234, idempotencyKey: "k" });
    expect(r).toMatchObject({ ok: true, replayed: false, transaction: { amountCents: 1234 } });
    expect(getBalance(db, 1)).toBe(a - 1234);
    expect(getBalance(db, 2)).toBe(b + 1234);
    expect(total(db)).toBe(sum);
    expect(getHistory(db, 1)).toHaveLength(1);
  });

  it("replaying the same key returns the original and does not move money again", () => {
    const db = setup();
    const req = { fromAccountId: 1, toAccountId: 2, amountCents: 1000, idempotencyKey: "k" };
    const first = transfer(db, req);
    const balance = getBalance(db, 1);
    const second = transfer(db, req);
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(second.ok && first.ok && second.transaction).toEqual(first.ok && first.transaction);
    expect(getBalance(db, 1)).toBe(balance);
    expect(getHistory(db, 1)).toHaveLength(1);
  });

  it("rejects insufficient funds and changes nothing", () => {
    const db = setup();
    const balance = getBalance(db, 1);
    const r = transfer(db, { fromAccountId: 1, toAccountId: 2, amountCents: balance + 1, idempotencyKey: "k" });
    expect(r).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(getBalance(db, 1)).toBe(balance);
    expect(getHistory(db, 1)).toHaveLength(0);
  });

  it("allows draining an account to exactly zero", () => {
    const db = setup();
    const balance = getBalance(db, 1);
    expect(transfer(db, { fromAccountId: 1, toAccountId: 2, amountCents: balance, idempotencyKey: "k" }).ok).toBe(true);
    expect(getBalance(db, 1)).toBe(0);
  });

  it.each([
    ["invalid_amount", { amountCents: 0 }],
    ["invalid_amount", { amountCents: -5 }],
    ["invalid_amount", { amountCents: 1.5 }],
    ["same_account", { toAccountId: 1 }],
    ["unknown_account", { toAccountId: 999 }],
    ["unknown_account", { fromAccountId: 999 }],
  ])("rejects %s", (reason, override) => {
    const db = setup();
    const sum = total(db);
    const r = transfer(db, { fromAccountId: 1, toAccountId: 2, amountCents: 100, idempotencyKey: "k", ...override });
    expect(r).toEqual({ ok: false, reason });
    expect(total(db)).toBe(sum);
    expect(getHistory(db, 1)).toHaveLength(0);
  });
});
