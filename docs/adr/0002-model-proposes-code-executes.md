# The model can propose a transfer but never execute one

The LLM gets five tools: `get_balance`, `get_history`, `list_accounts`, `find_account` and `propose_transfer`. `propose_transfer` only creates a Pending operation. Money moves only through a separate confirm endpoint (ADR-0004) that the model cannot call. Deterministic code validates every tool call and argument before acting on it.

This keeps a hallucinated or prompt-injected tool call from ever moving money, and lets the model's role be limited to understanding requests and phrasing replies.

## Consequences

The model is reached through an OpenAI-compatible gateway (`qwen3.8:27b`) using tool calling. If the gateway's tool calling proves unreliable, fall back to strict JSON output validated with zod. Only the model adapter changes; the safety boundary stays.
