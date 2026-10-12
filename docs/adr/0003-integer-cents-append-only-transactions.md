# Integer cents, append-only transactions, cached balance

Amounts are stored as integer cents in a single currency (SGD), never floats. Transactions are immutable, append-only rows and the source of truth for history. Each account also holds a cached balance, updated in the same DB transaction as the Transaction row, with `CHECK (balance >= 0)` as a backstop to the application-level insufficient-funds check.

## Considered Options

- **Mutable balance only:** loses history and auditability.
- **Full double-entry ledger with derived balances:** more correct in the general case, but unneeded for two-party transfers in a take-home.
