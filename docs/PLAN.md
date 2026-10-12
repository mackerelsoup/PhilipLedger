# Build plan and module layout

Assumes TypeScript on Node, `better-sqlite3` and zod (ADR-0001, 0002). Build in the order below. Steps 1 and 2 are the first deliverable: money moves safely and idempotently with no LLM involved.

## Layout

```
src/
  db/            connection, schema.sql, seed (alice, bob, alan)        ADR-0001, 0007
  ledger/        accounts, balances, transfer()                          ADR-0003
  transactions/  append-only records, history queries, idempotency keys  ADR-0003, 0004
  pending/       pending operation lifecycle, expiry, replace            ADR-0006
  auth/          users, login, sessions                                  ADR-0007
  agent/         LLM adapter, tools, validation, retry                   ADR-0002, 0005
  api/           HTTP routes: login, chat, confirm, reject               ADR-0004
  ui/            chat frontend, Confirm/Reject buttons, clarification list
tests/           mirrors src/
```

## Module responsibilities and boundaries

| Module | Owns | Must not |
|---|---|---|
| `ledger` | accounts, cached balance, `transfer()` (debit + credit + transaction row + idempotency record in one DB transaction) | know about chat, LLM or HTTP |
| `transactions` | immutable transaction rows, `getHistory()`, idempotency lookup | update or delete rows |
| `pending` | one pending op per session, 5-minute expiry, `collecting` / `awaiting_confirmation` | move money |
| `auth` | username/password check, session ids | touch accounts |
| `agent` | the five tools (`get_balance`, `get_history`, `list_accounts`, `find_account`, `propose_transfer`), model calls, 3x retry, one re-prompt on invalid tool call | import `ledger.transfer`. It can only reach `pending.propose()` and the read functions |
| `api` | routing and request validation. Confirm/reject routes are the only callers of `ledger.transfer` | accept free text on confirm/reject |
| `ui` | rendering, buttons | hold business logic |

Dependency direction: `ui -> api -> {agent, auth, pending, ledger, transactions} -> db`. `ledger` writes through `transactions` inside its own DB transaction. Nothing below `api` imports from `api` or `agent`.

## Build order

1. **`db`, `ledger`, `transactions`.** Schema with `CHECK (balance >= 0)`, `transfer()`, seed data. **Done** (`5fb3e66`, 18 tests).
   - Seed: alice, bob, alan, each 100,000 cents (SGD 1,000.00), demo password `demo1234`, scrypt-hashed.
   - Idempotency record is the `UNIQUE idempotency_key` column on `transactions`, not a separate table. Failed transfers leave no record. A replay returns the original transaction (`replayed: true`) even if its fields differ.
   - `transactions` is append-only, enforced by DB triggers as well as the module API.
   - `transfer()` returns `{ ok: false, reason }` for `invalid_amount`, `same_account`, `unknown_account`, `insufficient_funds`.
2. **`api` confirm and reject.** Call `transfer()` with the pending id as the idempotency key. Tests: double-confirm, insufficient funds, expired pending op.
3. **`auth` and `pending`.** Login against seeded users, replace-on-new-request, expiry.
4. **`agent` tools.** Plain functions with zod validation. `propose_transfer` only writes the pending row.
5. **`agent` LLM adapter.** Tool-calling loop, retry and backoff per ADR-0005. Test everything above with scripted tool calls first. If gateway tool calling is flaky, fall back to strict JSON plus zod (only this module changes).
6. **`ui`.** Chat view, Confirm/Reject buttons, clarification list for ambiguous recipients.
