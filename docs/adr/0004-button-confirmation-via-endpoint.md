# Confirmation is a Confirm/Reject button press handled by a separate endpoint

Every transfer requires explicit Confirmation, given only by pressing Confirm or Reject on the Pending operation shown in the chat UI. Each button calls a dedicated endpoint (confirm / reject) that the model cannot reach and that takes no free text. Typing "yes" or "confirm" in chat does nothing except re-show the buttons, so no wording can be misread as consent.

The idempotency key is the Pending operation's id, enforced by a `UNIQUE` constraint committed in the same DB transaction as the transfer. A double-click or retried request finds the operation already consumed and returns the original result instead of transferring again.

If the recipient is ambiguous, the system lists candidate accounts and asks the user to choose rather than guessing.

## Considered Options

- **Confirming by typing yes/confirm/okay in chat:** briefly adopted, then dropped. A word list has to guess at intent ("sure, go ahead"), whereas a button press is unambiguous and trivially testable.
- **Letting the model decide that a message means confirm:** rejected, since a misread or injected message could then move money.
- **Soft "same transfer seconds ago" warning:** guesswork; the key is a hard guarantee.
