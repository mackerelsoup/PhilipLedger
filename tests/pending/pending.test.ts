import { describe, expect, it } from "vitest";
import { confirm } from "../../src/api/confirm.js";
import { login } from "../../src/auth/index.js";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";
import { getBalance } from "../../src/ledger/index.js";
import { EXPIRY_MS, getActive, propose } from "../../src/pending/index.js";

const NOW = new Date("2026-01-01T00:00:00Z");

function setup() {
  const db = openDb();
  seed(db);
  const s = login(db, "alice", "demo1234");
  if (!s.ok) throw new Error("login");
  const p = (toAccountId: number, amountCents: number) =>
    propose(db, { sessionId: s.sessionId, accountId: 1, toAccountId, amountCents, now: NOW });
  return { db, sid: s.sessionId, p };
}

describe("pending", () => {
  it("propose stores an awaiting_confirmation op and moves no money", () => {
    const { db, sid, p } = setup();
    const { id, replaced } = p(2, 1000);
    expect(replaced).toBe(false);
    expect(getActive(db, sid, NOW)).toMatchObject({ id, toAccountId: 2, amountCents: 1000, state: "awaiting_confirmation" });
    expect(getBalance(db, 1)).toBe(100_000);
  });

  it("a new request replaces the old one; the old id can no longer be confirmed", () => {
    const { db, sid, p } = setup();
    const first = p(2, 1000);
    const second = p(3, 500);
    expect(second.replaced).toBe(true);
    expect(getActive(db, sid, NOW)?.id).toBe(second.id);
    expect(confirm(db, { pendingId: first.id, accountId: 1, now: NOW })).toEqual({ ok: false, reason: "not_found" });
    expect(confirm(db, { pendingId: second.id, accountId: 1, now: NOW })).toMatchObject({ ok: true });
    expect(getBalance(db, 3)).toBe(100_500);
  });

  it("expires after 5 minutes and is cleared", () => {
    const { db, sid, p } = setup();
    p(2, 1000);
    expect(getActive(db, sid, new Date(NOW.getTime() + EXPIRY_MS - 1))).toBeDefined();
    expect(getActive(db, sid, new Date(NOW.getTime() + EXPIRY_MS))).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) c FROM pending_operations").get()).toEqual({ c: 0 });
  });

  it("sessions are independent", () => {
    const { db, sid, p } = setup();
    const other = login(db, "bob", "demo1234");
    if (!other.ok) throw new Error("login");
    p(2, 1000);
    propose(db, { sessionId: other.sessionId, accountId: 2, toAccountId: 1, amountCents: 1, now: NOW });
    expect(getActive(db, sid, NOW)?.amountCents).toBe(1000);
  });
});
