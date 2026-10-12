# Agentic Ledger System

## Take-Home Assignment

## Overview

Build a simple **AI-powered ledger system** that can understand user requests and perform operations against a financial ledger.

The assignment evaluates how you design a reliable agentic application, including state management, interaction with external functionality, failure handling, and feedback. The implementation approach is intentionally open-ended. Make reasonable engineering decisions and document important assumptions or trade-offs.

**Time Guidance:** You can spend up to 2 days, but we recommend completing the core requirements in approximately 1 day.

## Functional Requirements

The project should:

### 1. Understand Ledger Requests

Accept natural-language requests relating to ledger operations, determine the appropriate action, and respond clearly.

### 2. Support Core Ledger Operations

Support account balance queries, transaction history, and transfers between accounts. Transfers must maintain correct balances and must not proceed with insufficient funds.

### 3. Maintain Workflow State

Maintain sufficient state to support request execution, particularly for multi-step operations or requests that require additional information. The state model and storage approach are up to you.

### 4. Handle Incomplete or Invalid Requests

Handle missing, invalid, or ambiguous information without making unsafe assumptions or executing unintended operations.

### 5. Handle Failures and Feedback

Respond appropriately when an operation cannot be completed. Recovery behaviour should be controlled and should not result in unbounded or repeated execution.

### 6. Prevent Duplicate Actions

Avoid executing the same consequential operation multiple times when the same request is accidentally submitted more than once. The implementation approach is up to you.

## System Behaviour

| Scenario | Expected Behaviour |
| --- | --- |
| **Successful request** | A valid request is understood, required conditions are checked, the operation is performed, resulting state remains consistent, and the user receives a clear response. |
| **Missing information** | The system recognises missing required information, does not invent critical details, and does not perform an unintended transaction. |
| **Failed operation** | Failures are handled gracefully and the system remains in a consistent state. Any recovery behaviour is controlled. |
| **Duplicate request** | Submitting the same consequential request again should not unintentionally perform the operation twice. |

## Design Considerations

**There is no single expected solution.** Make reasonable engineering decisions, document important assumptions, and explain meaningful trade-offs.

You may make your own decisions regarding architecture, state management, persistence, database or storage design, workflow, component interfaces, validation, error handling, retry or recovery behaviour, and additional ledger functionality.

You may create your own database or use another suitable storage approach if required, and you may extend the system beyond the minimum requirements where you believe it improves the design.

Avoid unnecessary complexity. A smaller solution with clear reasoning and reliable behaviour is preferable to a larger solution that is difficult to understand. Where requirements are unclear, make a reasonable assumption and document it.

## Notes for Candidates

- AI tools are encouraged for exploration, implementation, debugging, and boilerplate.
- Focus on correctness and clarity rather than UI.
- There is no need to over-engineer the solution.
- You may introduce additional components or functionality where justified.
- Briefly explain significant design decisions and trade-offs.

## Submission

Please share your GitHub repository link when complete.

Include a short `README.md` covering:

- How to run the project
- An overview of your design
- Important assumptions
- How state is managed
- How unsuccessful operations are handled
- Any additional functionality implemented
- Key design decisions or trade-offs

Please feel free to add anything you think is useful, as long as you can justify it in your README.

---

**CONFIDENTIAL**
