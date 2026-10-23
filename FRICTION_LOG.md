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

### 7. `@modelcontextprotocol/ext-apps` 2.x server helpers don't type-check against the stable v1 MCP SDK
- **Task:** Register the Echo Show card as an MCP Apps resource with `registerAppResource`.
- **Steps:** `@modelcontextprotocol/sdk@1.32.1` + `@modelcontextprotocol/ext-apps@2.0.3`, then `registerAppResource(server, name, uri, { description }, cb)`.
- **Expected:** Works with the `McpServer` the Alexa+ docs point to.
- **Actual:** `TS2353: 'description' does not exist in type 'McpUiAppResourceConfig'`. ext-apps 2.x depends on the v2 `@modelcontextprotocol/core` and `client` packages, so its types don't line up with a v1 `McpServer`. Bundling the `App` view class into the card produced a 590 KiB HTML resource, which is too heavy for a status card.
- **Severity:** low.
- **Workaround:** Registered the resource with the v1 SDK's `registerResource` and the MIME type `text/html;profile=mcp-app`. Implemented the view handshake (`ui/initialize`, `ui/notifications/initialized`, `ui/notifications/tool-result`) by hand, following ext-apps' published spec types. The card is now 3.1 KiB.
- **Suggestion:** State which MCP SDK major version the Alexa+ MCP Apps support targets, and publish a dependency-free view snippet for simple cards.

### 8. A new AWS account can sign in to the CLI but can't use any service until verification finishes
- **Task:** Deploy the stack (`pnpm deploy:aws`) to a newly created AWS account in us-east-1.
- **Steps:** `aws login --profile kinloop` succeeded and `aws sts get-caller-identity` returned the account. Then: a Bedrock `converse` call, `ssm put-parameter`, and `lambda list-functions`, `dynamodb list-tables`, `cloudformation list-stacks`, `sns list-topics` and `s3api list-buckets`.
- **Expected:** Either the services work, or one clear "account activation pending" error.
- **Actual:** Each service failed with a different message for the same root cause:
  - Bedrock: `AccessDeniedException: Your account is currently being verified… normally takes less than 2 hours`.
  - Lambda, DynamoDB and SSM: `SubscriptionRequiredException`.
  - CloudFormation and SNS: `OptInRequired`.
  - S3: `NotSignedUp`.
  
  Signing in to the CLI gives no hint that the account isn't active.
- **Severity:** blocker for deployment during a time-boxed hackathon.
- **Workaround:** Kept building and testing locally (the in-memory store and the template digest need no AWS). The deploy script is idempotent, so it re-runs as soon as activation completes.
- **Suggestion:** Make `aws login` and `sts get-caller-identity` warn when the account's activation is pending. Return one consistent error code (with the expected wait time) across services.

### 9. The new-experience project is locked to one region, but the CLI login didn't say so
- **Task:** Deploy after switching to the project-based account (536136153650, "new AWS experience").
- **Steps:** `aws login` in us-east-1, then the deploy.
- **Expected:** A clear message that the project only allows its own region.
- **Actual:** The region constraint (every resource must be in the project's region, here ap-southeast-2) only surfaced through the Agent Toolkit setup instructions and its starter rules. Nothing in the CLI login flow mentions it.
- **Severity:** medium.
- **Workaround:** Set the profile region to ap-southeast-2 and deployed there, using the `au.` Claude and `apac.` Nova inference profiles.
- **Suggestion:** Have `aws login` print the project's region, and default the profile region to it.

### 10. Lambda + serverless-http + MCP SDK Streamable HTTP returns 415 for every MCP call
- **Task:** Call `/mcp` on the deployed Lambda Function URL.
- **Steps:** POST `initialize` with `Content-Type: application/json`. Locally and in supertest this worked.
- **Expected:** 200.
- **Actual:** `415 Unsupported Media Type: Content-Type must be application/json`. The SDK's Node transport converts the request to a web `Request` with `@hono/node-server`, which builds headers only from `req.rawHeaders`. serverless-http populates `req.headers` but leaves `rawHeaders` empty, so the transport sees no headers. Auth still passed, because our middleware reads `req.headers`. That hid the problem until the first authenticated call.
- **Severity:** blocker (in production only).
- **Workaround:** Fill `req.rawHeaders` from `req.headers` before `transport.handleRequest`. Added a regression test that drives the app through serverless-http with a real Function URL v2 event; without the fix it fails with exactly 415.
- **Suggestion (MCP SDK):** Fall back to `req.headers` when `rawHeaders` is empty, or document that Lambda adapters must set `rawHeaders`.

### 11. An unhandled error on Lambda returned a stack trace as HTML
- **Task:** First demo seed after deploy.
- **Actual:** A DynamoDB `ValidationException` (empty string in `begins_with`, which the in-memory table had allowed) fell through to Express's default error handler. That handler returned a full HTML stack trace with `/var/task` paths.
- **Severity:** high (information leak).
- **Workaround:** Query the whole partition when the prefix is empty, and add a final JSON error handler with no internals, plus a test. The deploy script now fails loudly if seeding fails.
- **Suggestion:** Production Express starters should ship a JSON error handler by default.

### 12. Claude on Bedrock: "use case details have not been submitted" comes back as `ResourceNotFoundException`
- **Task:** First Converse call to `au.anthropic.claude-haiku-4-5-20251001-v1:0` after account verification finished.
- **Actual:** `ResourceNotFoundException: Model use case details have not been submitted for this account.` The model is listed and the inference profile exists. The error type suggests a wrong model ID, which isn't the problem.
- **Severity:** medium.
- **Workaround:** The digest falls back to Nova Lite automatically. The project owner has to submit the Anthropic use-case form in the Bedrock console.
- **Suggestion:** Use `AccessDeniedException` (or a dedicated code) and link to the form.

### 13. Nova Lite stated a dose was "missed" when it was only due
- **Task:** Bedrock digest for the family, in production.
- **Actual:** From facts listing Metformin as due now and not yet taken, Nova Lite wrote "missed Metformin at the same time". A clearer field name (`dueNowNotYetTaken`) and an explicit prompt rule didn't stop it.
- **Severity:** high for a caregiving product. It's a false claim to the family.
- **Workaround:** A deterministic `checkDigest` runs on every model output. It rejects "missed" claims when nothing was missed, medicines that aren't on the schedule, advice wording, and summaries that drop today's red flag. A rejected output falls through to the next model, then to the deterministic template. In production it rejected Nova's output and the accurate template went out.
- **Suggestion:** None for AWS. This is the reason the design keeps the LLM away from decisions and checks its words.

### 14. Nova Lite as a tool-use orchestrator leaks `<thinking>` and paraphrases tool results
- **Task:** Use `apac.amazon.nova-lite-v1:0` with Converse tool use as the simulated Alexa+ orchestrator, while the Claude use-case form was pending.
- **Actual:**
  - It picked the right MCP tool every time, but its final text began with `<thinking>…</thinking>`, which a voice assistant would read aloud.
  - It rewrote the tool's carefully worded speech, in one case changing a fact ("hasn't taken any of her two doses").
  - For "I just took my blood pressure pill" it sent `allDue: false` without the medicine words.
  - Orchestrated turns took about 2.5–4.8 s, mostly model time; the MCP tool calls stayed in the milliseconds.
- **Severity:** medium.
- **Workaround:** Strip `<thinking>` blocks. When a tool ran, speak the tool's own text rather than the model's paraphrase. Tightened the `medication` argument description so models pass the user's words.
- **Suggestion:** Document Nova's reasoning-tag behavior on the Converse page, and offer an option to suppress it.
