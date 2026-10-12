import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";

export const EXPIRY_MS = 5 * 60_000;

export interface Pending {
  id: string;
  toAccountId: number;
  amountCents: number;
  state: string;
  expiresAt: string;
}

/**
 * Creates the session's pending op, replacing any existing one (ADR-0006). Never moves money.
 * `replaced` lets the caller tell the user the old request was dropped.
 */
export function propose(
  db: Db,
  a: { sessionId: string; accountId: number; toAccountId: number; amountCents: number; now?: Date },
): { id: string; replaced: boolean } {
  const id = randomUUID();
  const expiresAt = new Date((a.now ?? new Date()).getTime() + EXPIRY_MS).toISOString();
  return db.transaction(() => {
    const { changes } = db.prepare("DELETE FROM pending_operations WHERE session_id = ?").run(a.sessionId);
    db.prepare(
      "INSERT INTO pending_operations (id, session_id, account_id, to_account_id, amount_cents, state, expires_at) VALUES (?, ?, ?, ?, ?, 'awaiting_confirmation', ?)",
    ).run(id, a.sessionId, a.accountId, a.toAccountId, a.amountCents, expiresAt);
    return { id, replaced: changes > 0 };
  }).immediate();
}

/** The session's live pending op. An expired one is cleared and reported as none. */
export function getActive(db: Db, sessionId: string, now = new Date()): Pending | undefined {
  const p = db
    .prepare(
      "SELECT id, to_account_id AS toAccountId, amount_cents AS amountCents, state, expires_at AS expiresAt FROM pending_operations WHERE session_id = ?",
    )
    .get(sessionId) as Pending | undefined;
  if (p && now.getTime() >= Date.parse(p.expiresAt)) {
    db.prepare("DELETE FROM pending_operations WHERE id = ?").run(p.id);
    return undefined;
  }
  return p;
}

/** Drops a pending op by id (used to undo a proposal when the turn that made it fails). */
export function cancel(db: Db, id: string): void {
  db.prepare("DELETE FROM pending_operations WHERE id = ?").run(id);
}
