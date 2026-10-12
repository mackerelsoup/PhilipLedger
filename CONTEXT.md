# Agentic Ledger

A chat-driven ledger where a user asks in natural language to check balances, view history and transfer money between accounts.

## Language

**Account**: A holder of a balance in a single currency (SGD), stored in integer cents. Never negative. Each Account is owned by exactly one User.

**User**: A person who logs in with username and password and acts as their one Account. Any Account may send to any other Account.

**Transfer**: A movement of money from the User's Account to another Account. Atomic: both sides happen or neither.

**Transaction**: An immutable record of a completed Transfer. The source of truth for history.

**Session**: A logged-in conversation.

**Pending operation**: The single unfinished Transfer in a Session, either collecting missing details or awaiting confirmation. Expires; replaced by a newer Transfer request.

**Confirmation**: The User pressing Confirm (or Reject) on a Pending operation in the chat UI. Typed replies never count.

**Clarification**: When the recipient is ambiguous, the system lists the candidate Accounts and asks the User to choose. It never guesses.

**Idempotency key**: The id of the Pending operation. Replaying a Confirmation of an already-executed operation returns the original result instead of transferring again.
