# Feature requests

Requests for the Alexa+ add-on platform and MCP Toolkit, based on building KinLoop.

### 1. Proactive notifications from an MCP add-on to a linked customer's device
**Urgency:** critical (for this category)
**Why:** A red-flag alert should reach the family member's own Echo ("Kamala just reported fainting"), not only email and SMS. MCP add-ons can only respond when spoken to today, so safety and caregiving add-ons have to send urgent signals through channels outside Alexa.

### 2. Documented, testable elicitation for stateless servers
**Urgency:** important
**Why:** The documented `initialize` only advertises `roots`, and a stateless Streamable HTTP server can't receive the reply to a mid-call `elicitation/create`. We built a two-step `confirm` argument for the destructive tool instead. Please publish a confirmation pattern that Alexa+ handles natively, for example by honoring `destructiveHint` with a built-in "Are you sure?".

### 3. A machine-readable list of account-linking redirect URIs
**Urgency:** important
**Why:** The redirect URIs live in the Developer Hub and vary by region. An authorization server has to hard-code them. A stable JSON endpoint, or including them in `alexa-ai get-account-linking`, would make exact-match redirect validation easy to automate.

### 4. Multi-person households in one add-on
**Urgency:** important
**Why:** KinLoop serves a parent and their children with different roles from one MCP server. Account linking is per Amazon account, so each person links separately and we infer the role from the KinLoop login. A way to pass a household or person hint (with consent) would let one Echo in the parent's home behave correctly for visitors.

### 5. Hindi and regional-language locales for add-ons
**Urgency:** important
**Why:** Many of the elders who would use KinLoop are more comfortable in Hindi, Tamil, Bengali and other languages than in English. Support for `hi-IN` and code-mixed Hinglish for MCP add-ons would remove our biggest adoption barrier.

### 6. A Local Inspector that accepts a bearer token or runs the OAuth flow
**Urgency:** nice-to-have
**Why:** Most real add-ons require account linking. The Local Inspector page doesn't document how to authenticate, so certification checks on authenticated tools are hard to run locally.

### 7. Publish the CLI and Local Inspector under an Amazon-owned npm scope
**Urgency:** nice-to-have (supply-chain hygiene)
**Why:** `alexa-ai` on npm is an unrelated third-party package. Developers and coding agents will guess package names from the docs.
