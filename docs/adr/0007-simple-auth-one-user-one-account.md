# Username/password login, one user owns one account

Users log in with a username and password against seeded demo accounts (`alice`, `bob`, `alan`, all with a demo-only password). Each user acts as exactly one Account, and any Account may send to any other. This is deliberately minimal: real auth, multiple accounts per user and permissions are out of scope, but ambiguity still arises from similar recipient names (e.g. `alice` vs `alan`).
