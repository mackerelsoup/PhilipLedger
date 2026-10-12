import { describe, expect, it } from "vitest";
import { accountOfSession, login } from "../../src/auth/index.js";
import { openDb } from "../../src/db/index.js";
import { seed } from "../../src/db/seed.js";

const setup = () => {
  const db = openDb();
  seed(db);
  return db;
};

describe("auth", () => {
  it("logs in a seeded user and resolves the session to their account", () => {
    const db = setup();
    const r = login(db, "bob", "demo1234");
    expect(r).toMatchObject({ ok: true, accountId: 2 });
    expect(r.ok && accountOfSession(db, r.sessionId)).toBe(2);
  });

  it("rejects bad password and unknown user identically", () => {
    const db = setup();
    expect(login(db, "alice", "wrong")).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(login(db, "nobody", "demo1234")).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("unknown or missing session has no account", () => {
    const db = setup();
    expect(accountOfSession(db, "nope")).toBeUndefined();
    expect(accountOfSession(db, undefined)).toBeUndefined();
  });
});
