# SQLite for ledger, workflow state and idempotency keys

We store accounts, transactions, pending operations and idempotency keys in one SQLite file (`better-sqlite3`). A transfer's debit, credit, transaction row and idempotency record then commit atomically, and the DB rejects overdrafts even if application code is wrong.

## Considered Options

- **Postgres:** same guarantees, but needs a server or Docker. Its concurrency strengths don't matter here.
- **JSON file / in-memory:** no atomicity, so a crash mid-transfer can corrupt state. Dedupe and locking would be hand-rolled.
- **Redis / key-value:** only single-key atomicity. Multi-key transfers need scripting.

## Consequences

Single writer, single process. Fine for this scope; moving to Postgres later means rewriting the thin data layer.
