import type { Db } from "../db/index.js";
import { findByIdempotencyKey, insertTransaction, type NewTransaction, type Transaction } from "../transactions/index.js";

export type TransferResult =
  | { ok: true; replayed: boolean; transaction: Transaction }
  | { ok: false; reason: "invalid_amount" | "same_account" | "unknown_account" | "insufficient_funds" };

export function getBalance(db: Db, accountId: number): number | undefined {
  const row = db.prepare("SELECT balance_cents AS b FROM accounts WHERE id = ?").get(accountId) as
    | { b: number }
    | undefined;
  return row?.b;
}

/**
 * Atomic debit + credit + transaction row. Replaying an idempotency key returns the original
 * transaction without moving money again (the original wins even if the replay's fields differ).
 */
export function transfer(db: Db, req: NewTransaction): TransferResult {
  return db.transaction((): TransferResult => {
    const prior = findByIdempotencyKey(db, req.idempotencyKey);
    if (prior) return { ok: true, replayed: true, transaction: prior };

    if (!Number.isSafeInteger(req.amountCents) || req.amountCents <= 0) return { ok: false, reason: "invalid_amount" };
    if (req.fromAccountId === req.toAccountId) return { ok: false, reason: "same_account" };
    const balance = getBalance(db, req.fromAccountId);
    if (balance === undefined || getBalance(db, req.toAccountId) === undefined) {
      return { ok: false, reason: "unknown_account" };
    }
    if (balance < req.amountCents) return { ok: false, reason: "insufficient_funds" };

    const move = db.prepare("UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?");
    move.run(-req.amountCents, req.fromAccountId);
    move.run(req.amountCents, req.toAccountId);
    return { ok: true, replayed: false, transaction: insertTransaction(db, req) };
  }).immediate();
}
