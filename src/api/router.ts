import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { chat, type LlmDeps } from "../agent/llm.js";
import { login } from "../auth/index.js";
import type { Db } from "../db/index.js";
import { getUsername } from "../ledger/index.js";
import { getActive } from "../pending/index.js";
import { confirm, reject } from "./confirm.js";

const STATUS: Record<string, number> = {
  not_found: 404,
  expired: 410,
  not_ready: 409,
  insufficient_funds: 409,
  invalid_amount: 422,
  same_account: 422,
  unknown_account: 422,
  rate_limited: 429,
  llm_unavailable: 502,
  invalid_tool_call: 502,
  too_many_steps: 502,
};

const page = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");

export const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return {};
  }
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Serves the UI, POST /login, POST /chat, and POST /pending/:id/confirm|reject.
 * Confirm/reject read no body (ADR-0004: no free text). `accountOf` resolves the caller's account;
 * `llm` enables /chat. Chat history is kept in memory per session; losing it on restart is fine
 * because pending state lives in SQLite (ADR-0006).
 */
export function createApi(db: Db, accountOf: (req: IncomingMessage) => number | undefined, llm?: LlmDeps): Server {
  const histories = new Map<string, Parameters<typeof chat>[3]>();
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/") {
      return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    }
    if (req.method === "POST" && req.url === "/login") {
      const b = await readJson(req);
      const r = login(db, String(b.username ?? ""), String(b.password ?? ""));
      return r.ok ? send(200, { ok: true, sessionId: r.sessionId }) : send(401, r);
    }
    const m = req.method === "POST" && /^\/pending\/([^/]+)\/(confirm|reject)$/.exec(req.url ?? "");
    if (!m && !(req.method === "POST" && req.url === "/chat" && llm)) return send(404, { ok: false, reason: "not_found" });
    const accountId = accountOf(req);
    if (accountId === undefined) return send(401, { ok: false, reason: "unauthenticated" });
    if (m) {
      const pendingId = decodeURIComponent(m[1]!);
      const result = m[2] === "confirm" ? confirm(db, { pendingId, accountId }) : reject(db, { pendingId, accountId });
      return send(result.ok ? 200 : (STATUS[result.reason] ?? 500), result);
    }
    const sessionId = bearer(req)!;
    const text = String((await readJson(req)).text ?? "").trim().slice(0, 500);
    if (!text) return send(422, { ok: false, reason: "empty_message" });
    const r = await chat(llm!, { db, sessionId, accountId }, text, histories.get(sessionId));
    if (!r.ok) return send(STATUS[r.reason] ?? 500, r);
    histories.set(sessionId, r.history.slice(-40));
    const p = getActive(db, sessionId);
    const to = p && getUsername(db, p.toAccountId);
    send(200, { ok: true, reply: r.reply, pending: p && { id: p.id, to, amountCents: p.amountCents } });
  });
}
