import type { Db } from "../db/index.js";

export interface Transaction {
  id: number;
  fromAccountId: number;
  toAccountId: number;
  amountCents: number;
  idempotencyKey: string;
  createdAt: string;
}

export type NewTransaction = Omit<Transaction, "id" | "createdAt">;

const COLUMNS = `id, from_account_id AS fromAccountId, to_account_id AS toAccountId,
  amount_cents AS amountCents, idempotency_key AS idempotencyKey, created_at AS createdAt`;

/** Append-only: there is deliberately no update or delete (also enforced by DB triggers). */
export function insertTransaction(db: Db, t: NewTransaction): Transaction {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO transactions (from_account_id, to_account_id, amount_cents, idempotency_key) VALUES (?, ?, ?, ?)",
    )
    .run(t.fromAccountId, t.toAccountId, t.amountCents, t.idempotencyKey);
  return db.prepare(`SELECT ${COLUMNS} FROM transactions WHERE id = ?`).get(lastInsertRowid) as Transaction;
}

export function findByIdempotencyKey(db: Db, key: string): Transaction | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM transactions WHERE idempotency_key = ?`).get(key) as
    | Transaction
    | undefined;
}

/** Transactions where the account is sender or recipient, newest first. */
export function getHistory(db: Db, accountId: number, limit = 50): Transaction[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM transactions
       WHERE from_account_id = ? OR to_account_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(accountId, accountId, limit) as Transaction[];
}
