import type { Db } from "../db/index.js";
import { transfer, type TransferResult } from "../ledger/index.js";
import { findByIdempotencyKey } from "../transactions/index.js";

export type ConfirmResult = TransferResult | { ok: false; reason: "not_found" | "not_ready" | "expired" };

interface PendingRow {
  toAccountId: number;
  amountCents: number;
  state: string;
  expiresAt: string;
}

const find = (db: Db, id: string, accountId: number) =>
  db
    .prepare(
      `SELECT to_account_id AS toAccountId, amount_cents AS amountCents, state, expires_at AS expiresAt
       FROM pending_operations WHERE id = ? AND account_id = ?`,
    )
    .get(id, accountId) as PendingRow | undefined;

/**
 * Confirm button (ADR-0004). The pending id is the idempotency key, so a repeat press returns the
 * original transaction. Someone else's ops are indistinguishable from missing ones.
 */
export function confirm(db: Db, a: { pendingId: string; accountId: number; now?: Date }): ConfirmResult {
  const { pendingId, accountId, now = new Date() } = a;
  return db.transaction((): ConfirmResult => {
    const pending = find(db, pendingId, accountId);
    if (!pending) {
      const done = findByIdempotencyKey(db, pendingId);
      if (done?.fromAccountId !== accountId) return { ok: false, reason: "not_found" };
      return { ok: true, replayed: true, transaction: done };
    }
    if (pending.state !== "awaiting_confirmation") return { ok: false, reason: "not_ready" };
    if (now.getTime() >= Date.parse(pending.expiresAt)) {
      db.prepare("DELETE FROM pending_operations WHERE id = ?").run(pendingId);
      return { ok: false, reason: "expired" };
    }
    const result = transfer(db, {
      fromAccountId: accountId,
      toAccountId: pending.toAccountId,
      amountCents: pending.amountCents,
      idempotencyKey: pendingId,
    });
    if (result.ok) db.prepare("DELETE FROM pending_operations WHERE id = ?").run(pendingId);
    return result;
  }).immediate();
}

/** Reject button: drops the pending op. Nothing to reject once executed or gone. */
export function reject(db: Db, a: { pendingId: string; accountId: number }): { ok: true } | { ok: false; reason: "not_found" } {
  const { changes } = db.prepare("DELETE FROM pending_operations WHERE id = ? AND account_id = ?").run(a.pendingId, a.accountId);
  return changes ? { ok: true } : { ok: false, reason: "not_found" };
}
