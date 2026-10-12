import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/index.js";

export type LoginResult = { ok: true; sessionId: string; accountId: number } | { ok: false; reason: "invalid_credentials" };

function verify(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), expected.length), expected);
}

/** Checks username/password against seeded users and opens a session. Same failure for unknown user and bad password. */
export function login(db: Db, username: string, password: string, now = new Date()): LoginResult {
  const row = db
    .prepare("SELECT u.password_hash AS hash, a.id AS accountId FROM users u JOIN accounts a ON a.user_id = u.id WHERE u.username = ?")
    .get(username) as { hash: string; accountId: number } | undefined;
  if (!row || !verify(password, row.hash)) return { ok: false, reason: "invalid_credentials" };
  const sessionId = randomUUID();
  db.prepare("INSERT INTO sessions (id, account_id, created_at) VALUES (?, ?, ?)").run(sessionId, row.accountId, now.toISOString());
  return { ok: true, sessionId, accountId: row.accountId };
}

/** Resolves a session id to its account; plugs into `createApi`'s `accountOf`. */
export function accountOfSession(db: Db, sessionId: string | undefined): number | undefined {
  if (!sessionId) return undefined;
  const row = db.prepare("SELECT account_id AS accountId FROM sessions WHERE id = ?").get(sessionId) as { accountId: number } | undefined;
  return row?.accountId;
}
