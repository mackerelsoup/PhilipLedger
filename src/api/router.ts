import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Db } from "../db/index.js";
import { confirm, reject } from "./confirm.js";

const STATUS: Record<string, number> = {
  not_found: 404,
  expired: 410,
  not_ready: 409,
  insufficient_funds: 409,
  invalid_amount: 422,
  same_account: 422,
  unknown_account: 422,
};

/**
 * POST /pending/:id/confirm and /reject. No request body is read (ADR-0004: no free text).
 * `accountOf` resolves the caller's account from the request; auth plugs in at build step 3.
 */
export function createApi(db: Db, accountOf: (req: IncomingMessage) => number | undefined): Server {
  return createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    const m = req.method === "POST" && /^\/pending\/([^/]+)\/(confirm|reject)$/.exec(req.url ?? "");
    if (!m) return send(404, { ok: false, reason: "not_found" });
    const accountId = accountOf(req);
    if (accountId === undefined) return send(401, { ok: false, reason: "unauthenticated" });
    const pendingId = decodeURIComponent(m[1]!);
    const result = m[2] === "confirm" ? confirm(db, { pendingId, accountId }) : reject(db, { pendingId, accountId });
    send(result.ok ? 200 : (STATUS[result.reason] ?? 500), result);
  });
}
