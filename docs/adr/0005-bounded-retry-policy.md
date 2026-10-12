# Bounded retries for LLM calls, none for ledger writes

LLM and network errors are retried up to 3 times with short backoff, then the failure is reported to the user and nothing is changed. An invalid tool call from the model is re-prompted once with the validation error, then abandoned. A gateway 429 is not retried; the user is told to wait. Ledger writes are never auto-retried: they commit or roll back, and the user retries explicitly, protected by the idempotency key (ADR-0004, keyed by Pending operation id). Business errors (insufficient funds, unknown recipient) are explained, not retried.

This guarantees recovery can never cause unbounded or repeated execution.
