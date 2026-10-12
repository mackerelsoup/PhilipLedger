CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

-- One user owns exactly one account (ADR-0007). Balance in integer cents (ADR-0003).
CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
  balance_cents INTEGER NOT NULL CHECK (typeof(balance_cents) = 'integer' AND balance_cents >= 0)
);

-- Append-only; the idempotency key is the pending operation id (CONTEXT.md).
CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_account_id <> to_account_id)
);

CREATE TRIGGER transactions_no_update BEFORE UPDATE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;

CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL
);

-- One per session (ADR-0006): UNIQUE session_id, nullable so ops can exist without a session (confirm tests).
-- Deleted on confirm, reject or expiry; the executed result lives on transactions via idempotency_key.
CREATE TABLE pending_operations (
  id            TEXT PRIMARY KEY,
  session_id    TEXT UNIQUE REFERENCES sessions(id),
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount_cents  INTEGER NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('collecting', 'awaiting_confirmation')),
  expires_at    TEXT NOT NULL
);
