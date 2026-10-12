import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";

describe("db", () => {
  it("seeds alice, bob and alan, each with one account", () => {
    const db = openDb();
    seed(db);
    const rows = db
      .prepare("SELECT u.username, a.balance_cents FROM users u JOIN accounts a ON a.user_id = u.id ORDER BY u.username")
      .all() as { username: string; balance_cents: number }[];
    expect(rows.map((r) => r.username)).toEqual(["alan", "alice", "bob"]);
    expect(rows.every((r) => Number.isInteger(r.balance_cents) && r.balance_cents > 0)).toBe(true);
  });

  it("rejects a negative balance", () => {
    const db = openDb();
    seed(db);
    expect(() => db.prepare("UPDATE accounts SET balance_cents = -1 WHERE id = 1").run()).toThrow();
  });

  it("allows only one account per user", () => {
    const db = openDb();
    seed(db);
    expect(() => db.prepare("INSERT INTO accounts (user_id, balance_cents) VALUES (1, 0)").run()).toThrow();
  });
});
