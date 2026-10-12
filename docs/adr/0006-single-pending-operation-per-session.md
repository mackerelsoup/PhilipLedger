# One pending operation per session, persisted with expiry

A Session holds at most one Pending operation (`collecting` or `awaiting_confirmation`), stored in SQLite with a 5-minute expiry. A new transfer request replaces the old one and tells the user. Cancel, expiry or completion clears it.

Persisting it (rather than keeping it in the model's conversation) means the model can't invent or lose state, and the confirm endpoint acts on exactly what the user saw.
