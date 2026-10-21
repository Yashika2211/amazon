# Friction log

Real problems hit while building KinLoop, in the order we hit them. Severity scale: **blocker / high / medium / low**.

---

### 1. The `llms.txt` docs index returns 404
- **Task:** Read the Alexa+ docs index before building, as the hackathon brief recommends.
- **Steps:** `GET https://developer.amazon.com/docs/llms.txt`
- **Expected:** A machine-readable index of the Alexa+ docs.
- **Actual:** HTTP 404. The MCP Toolkit overview page still links to `/docs/llms.txt`.
- **Severity:** medium. Coding agents are told to start from this file.
- **Workaround:** Found the pages through web search and read the quickstart, account-linking, client-lifecycle, design-guide, local-inspector and CLI-reference pages one at a time.
- **Suggestion:** Publish `llms.txt` at the linked URL, or fix the link.

### 2. The CLI install command is not on the quickstart, overview or CLI reference page
- **Task:** Install the Alexa AI CLI.
- **Steps:** Read the quickstart, the MCP Toolkit overview and the Alexa AI CLI reference.
- **Expected:** An `npm install -g …` (or similar) line.
- **Actual:** All three pages defer to a "Set Up Your Development Environment" page. The reference documents every command but not how to get the binary. The Local Inspector page names its package (`@alexa-ai/addon-local-inspector`), but `npm view` returns 404 for that package on the public registry.
- **Severity:** high. Nothing can be registered without the CLI.
- **Workaround:** Pending. We need to sign in to the developer console.
- **Suggestion:** Put the install command at the top of the quickstart, and note whether the package is on a private registry.

### 3. `alexa-ai` on npm is an unrelated third-party package
- **Task:** Guess the CLI package name after friction item 2.
- **Steps:** `npm view alexa-ai`
- **Expected:** Amazon's CLI, or nothing.
- **Actual:** `alexa-ai@2.6.0` is a WhatsApp chatbot engine from an unrelated publisher. A developer, or a coding agent, following "install the alexa-ai CLI" could install it.
- **Severity:** high (supply-chain risk).
- **Workaround:** Did not install it.
- **Suggestion:** Publish the CLI under an Amazon-owned npm scope, document the exact package name, and consider asking npm to reserve the name.

### 4. Two pages document different flags for `configure-account-linking`
- **Task:** Plan how the OAuth client is registered.
- **Steps:** Compared the account-linking page with the CLI reference.
- **Expected:** The same flags on both.
- **Actual:** The account-linking page shows `--addon-id <id> --stage development --client-id <client-id>`, with the secret read from a masked prompt or `ALEXA_CLIENT_SECRET`. The CLI reference lists `--addon-id` and `--config-file`, both required, and no `--client-id`.
- **Severity:** medium.
- **Workaround:** Will run `alexa-ai configure-account-linking --help` once the CLI is installed.
- **Suggestion:** Generate the reference from the CLI's own help output.

### 5. The brief says server-driven elicitation, but Alexa+ doesn't advertise the `elicitation` capability
- **Task:** Confirm medication changes with MCP elicitation.
- **Steps:** Read the client-lifecycle page. The documented `initialize` sends `capabilities: { roots: { listChanged: true } }` and nothing else.
- **Expected:** `capabilities.elicitation` when the client supports `elicitation/create`.
- **Actual:** The client doesn't advertise it. A stateless Streamable HTTP server (which the session model encourages) also can't receive the client's reply to a server request made mid-call. The docs say Alexa+ "uses the MCP elicitation framework" for missing arguments, but don't explain how that works with the capability it sends.
- **Severity:** medium.
- **Workaround:** `update_medication_schedule` takes a `confirm` boolean. The first call returns a spoken preview plus `needsConfirmation: true`. Alexa+ asks the user and then calls again with `confirm: true`. The input schema stays strict so Alexa+ can fill arguments from context.
- **Suggestion:** Document exactly when Alexa+ answers `elicitation/create`, and with which capability.

### 6. The documented `initialize` uses protocol 2025-03-26, but the server requirement says 2025-11-25
- **Task:** Version negotiation.
- **Steps:** Compared the overview ("supports the 2025-11-25 specification") with the client-lifecycle sample (`protocolVersion: "2025-03-26"`).
- **Expected:** One version.
- **Actual:** The client offers 2025-03-26. A server that only accepts 2025-11-25 would fail to negotiate.
- **Severity:** low, because the SDK negotiates down.
- **Workaround:** Use the official SDK's negotiation, and add a test that sends the exact Alexa+ `initialize` payload and expects `2025-03-26` back.
- **Suggestion:** Say on the requirements page which versions the client actually offers.
