# Agentic Ledger

A chat-driven ledger. Ask in natural language to check your balance, view history or send money to another account. The model understands the request; deterministic code decides what actually happens, and money only moves when you press **Confirm**.

## Try it

**Hosted demo:** https://philipledger.onrender.com. No API key or setup needed.

Three demo accounts are seeded, each with SGD 1,000.00. The password for all of them is `demo1234`:

| Username | Password |
|---|---|
| alice | demo1234 |
| bob | demo1234 |
| alan | demo1234 |

Open two browsers (or a private window) to log in as two users and watch a transfer land on the other side.

Things to try: "what's my balance?", "who can I send to?", "show my last transactions" (each shows who it was sent to or received from, with times in Singapore time), "send 10 dollars to bob", "send 5000 to alan" (insufficient funds), and pressing Confirm twice on the same request.

State (balances, transactions, sessions, pending requests) persists for as long as the server keeps running. If the server restarts, the database may be reset back to the seeded accounts.

## Run locally

Requires Node 20+ (tested on Node 24).

```bash
npm install
```

Create a `.env` file in the project root with an OpenAI-compatible chat endpoint:

```
LLM_BASE_URL=https://your-gateway.example/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model-name
```

- `LLM_BASE_URL` is the base URL including `/v1`. The app calls `{LLM_BASE_URL}/chat/completions`.
- The model must support tool calling.
- `.env` and `*.db` files are gitignored.

Then start the server, loading the env file:

```bash
npm run start:dev
```

Open http://localhost:3000. The server creates `ledger.db` on first run and seeds the three demo accounts above. Delete `ledger.db` (and its `-wal` / `-shm` files) to reset.

Other commands:

```bash
npm test            # full test suite (no LLM needed; the model is scripted in tests)
npm run typecheck
```

## Design overview

```
src/
  db/            SQLite connection, schema, seed
  ledger/        accounts, balances, transfer()
  transactions/  append-only records, history, idempotency lookup
  pending/       one pending operation per session, expiry, replace
  auth/          login and sessions
  agent/         LLM adapter, the five tools, validation, retry
  api/           HTTP routes: login, chat, confirm, reject
  ui/            single-page chat with Confirm/Reject buttons, markdown replies, typing indicator
```

The key idea is a hard split between *understanding* and *acting*:

1. You type a request. The model can only call five tools: `get_balance`, `get_history`, `list_accounts`, `find_account`, `propose_transfer`.
2. `propose_transfer` only writes a **pending operation**. It never moves money.
3. The UI shows a card with **Confirm** and **Reject** buttons. Only the button hits the confirm endpoint, which is the only code path that calls `ledger.transfer()`. Typing "yes" does nothing.
4. The pending operation's id is the idempotency key, so a repeated Confirm returns the original result instead of transferring twice.

Guardrails around the model:

- **Fixed tool output.** Every tool returns the same envelope, `{ ok, data, error }`, where exactly one of `data` and `error` is non-null and `error` is `{ code, detail }`.
- **Strict validation.** Tool names and arguments are checked with zod (unknown fields are rejected). The acting account comes from the login session, never from the model.
- **Module boundary.** `agent` runs no SQL and can only reach `pending.propose()` / `pending.cancel()` and read functions. It never imports `ledger.transfer`.
- **Confirm card is trustworthy.** It shows the amount and recipient stored in the database, not the model's wording. Model replies are rendered as markdown and sanitised before display.
- **Grounded, brief replies.** The model is instructed to answer only what was asked, to state only facts from tool results in the same turn (checking balance and history before claiming a transfer happened), and not to speculate. Tools return ready-made `SGD x.xx` strings and Singapore-time (SGT) timestamps, so the model never converts cents or time zones itself. This is a prompt instruction, not a hard guarantee.
- **Known gaps:** no rate limiting on login or chat, sessions do not expire, and there is no request timeout on LLM calls. The balance is only visible by asking the assistant; it should be a clearly visible element in the UI at all times (and refresh after a confirmed transfer).

The module layout and build order are in [`docs/PLAN.md`](docs/PLAN.md); domain terms are in [`CONTEXT.md`](CONTEXT.md).

## Assumptions and decisions

Each decision has an ADR explaining the reasoning and trade-offs:

| Topic | ADR |
|---|---|
| SQLite holds all state (accounts, transactions, sessions, pending ops) | [0001](docs/adr/0001-sqlite-for-all-state.md) |
| The model proposes, code executes; the model cannot move money | [0002](docs/adr/0002-model-proposes-code-executes.md) |
| Money is integer cents; transactions are append-only | [0003](docs/adr/0003-integer-cents-append-only-transactions.md) |
| Confirmation is a button hitting an endpoint, never typed text; duplicate protection via idempotency key | [0004](docs/adr/0004-button-confirmation-via-endpoint.md) |
| LLM/network errors retried a bounded number of times; ledger writes never auto-retried | [0005](docs/adr/0005-bounded-retry-policy.md) |
| One pending operation per session, with a 5-minute expiry | [0006](docs/adr/0006-single-pending-operation-per-session.md) |
| Simple auth: one user, one account, seeded demo users | [0007](docs/adr/0007-simple-auth-one-user-one-account.md) |

Other points worth knowing:

- **Seeded data:** the three accounts are for testing. There is no signup.
- **Currency and time:** a single currency, SGD. Timestamps are stored in UTC and shown to the model and user in SGT.
- **Recipients:** `list_accounts` shows everyone you can send to; `find_account` searches by name. Any account may send to any other (ADR-0007).
- **Failures:** insufficient funds, expired requests and unknown recipients are explained to the user and change nothing. If the model is unreachable (after bounded retries), the user is told and nothing is changed, including any transfer proposal made earlier in that same turn (ADR-0005). A rate-limited gateway (429) is not retried. An invalid tool call from the model is re-prompted once, then the turn is abandoned.
- **Ambiguous recipients:** the assistant lists the candidates and asks you to choose rather than guessing.
- **Chat history** is kept in memory per session; pending operations are stored in SQLite, so the model can never invent or lose the state of a transfer.
