import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { findByIdempotencyKey, getHistory, insertTransaction } from "../../src/transactions/index.js";

const setup = () => {
  const db = openDb();
  seed(db);
  return db;
};

describe("transactions", () => {
  it("appends and looks up by idempotency key", () => {
    const db = setup();
    const t = insertTransaction(db, { fromAccountId: 1, toAccountId: 2, amountCents: 500, idempotencyKey: "k1" });
    expect(t).toMatchObject({ fromAccountId: 1, toAccountId: 2, amountCents: 500, idempotencyKey: "k1" });
    expect(findByIdempotencyKey(db, "k1")).toEqual(t);
    expect(findByIdempotencyKey(db, "nope")).toBeUndefined();
  });

  it("rejects a duplicate idempotency key", () => {
    const db = setup();
    const row = { fromAccountId: 1, toAccountId: 2, amountCents: 500, idempotencyKey: "k1" };
    insertTransaction(db, row);
    expect(() => insertTransaction(db, row)).toThrow();
  });

  it("rejects non-positive, fractional and self transfers at the DB", () => {
    const db = setup();
    const base = { fromAccountId: 1, toAccountId: 2, amountCents: 100, idempotencyKey: "x" };
    expect(() => insertTransaction(db, { ...base, amountCents: 0 })).toThrow();
    expect(() => insertTransaction(db, { ...base, idempotencyKey: "y", amountCents: 1.5 })).toThrow();
    expect(() => insertTransaction(db, { ...base, idempotencyKey: "z", toAccountId: 1 })).toThrow();
  });

  it("is immutable: update and delete are rejected", () => {
    const db = setup();
    insertTransaction(db, { fromAccountId: 1, toAccountId: 2, amountCents: 500, idempotencyKey: "k1" });
    expect(() => db.prepare("UPDATE transactions SET amount_cents = 1").run()).toThrow();
    expect(() => db.prepare("DELETE FROM transactions").run()).toThrow();
  });

  it("returns history for either side, newest first", () => {
    const db = setup();
    insertTransaction(db, { fromAccountId: 1, toAccountId: 2, amountCents: 100, idempotencyKey: "a" });
    insertTransaction(db, { fromAccountId: 2, toAccountId: 3, amountCents: 200, idempotencyKey: "b" });
    insertTransaction(db, { fromAccountId: 3, toAccountId: 1, amountCents: 300, idempotencyKey: "c" });
    expect(getHistory(db, 1).map((t) => t.idempotencyKey)).toEqual(["c", "a"]);
    expect(getHistory(db, 2).map((t) => t.idempotencyKey)).toEqual(["b", "a"]);
    expect(getHistory(db, 1, 1)).toHaveLength(1);
  });
});
