import { randomBytes, scryptSync } from "node:crypto";
import type { Db } from "./index.js";

const DEMO_PASSWORD = "demo1234"; // demo-only (ADR-0007)
const OPENING_BALANCE_CENTS = 100_000; // SGD 1,000.00

const hash = (pw: string) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
};

/** Seeds alice, bob and alan with one account each. Ids follow insertion order. */
export function seed(db: Db): void {
  const user = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
  const account = db.prepare("INSERT INTO accounts (user_id, balance_cents) VALUES (?, ?)");
  db.transaction(() => {
    for (const name of ["alice", "bob", "alan"]) {
      const { lastInsertRowid } = user.run(name, hash(DEMO_PASSWORD));
      account.run(lastInsertRowid, OPENING_BALANCE_CENTS);
    }
  })();
}
