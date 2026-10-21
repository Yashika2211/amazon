# Product feedback

Honest notes on every tool, API and SDK we used. Where we couldn't use something yet, we say so rather than guess.

---

## Alexa+ MCP Toolkit documentation
- **Used for:** server requirements, account linking, client lifecycle, design guidance, Local Inspector, CLI reference.
- **What worked:** the requirements are crisp where they exist:
  - Streamable HTTP only;
  - responses under 500 ms;
  - PKCE S256 required, with no DCR, CIMD or OIDC;
  - 401 with no `WWW-Authenticate`;
  - refresh requests omit `resource`.
  
  The client-lifecycle page's real `initialize` and `tools/call` payloads were the most useful thing in the docs. We turned the `initialize` payload straight into a test.
- **What needs work:**
  - `/docs/llms.txt` returns 404 even though pages link to it.
  - No page we found gives the CLI install command.
  - The account-linking page and the CLI reference document different flags for `configure-account-linking`.
  - The overview cites spec 2025-11-25 while the client offers 2025-03-26, and neither page says which versions are accepted.
  - Elicitation is mentioned, but the documented client doesn't advertise the capability.
  - The design guide's landing page has no concrete rules for tool descriptions or response length.
- **Onboarding:** good concepts, but some of the hard facts needed detective work.
- **Would build with it again:** yes.

## Alexa AI CLI and the Add-on Agent Skill
- **Used for:** planned for `configure`, `new mcp`, `configure-account-linking`, `deploy` and `submit`.
- **What happened:** we couldn't install it during the hackathon. The public docs we read don't name the package, and `alexa-ai` on npm is an unrelated WhatsApp bot. The CLI is gated behind developer-console access that the team didn't have, so we followed CUT LINE A: the simulated Alexa+ client is our demo path. We prepared everything the CLI needs: `addon.json` rendered and validated against every documented limit, all icon sizes, a carousel image, privacy and terms URLs, and an OAuth client. See the friction log.
- **Suggestion:** publish the CLI under an Amazon npm scope with one install line at the top of the quickstart.

## Local Inspector
- **Used for:** not run. Its documented package (`@alexa-ai/addon-local-inspector`) isn't on the public npm registry.
- **What looked good:** the certification verdict files (`certification-verdict.json`, CERTIFIED/CONDITIONAL/NOT_CERTIFIED) are exactly what a CI pipeline wants.
- **What needs work:** document how to pass a bearer token for account-linked servers.

## Alexa+ web simulator
- **Used for:** not reached, for the same reason as the CLI. Our own simulated client reproduces the flow: a Bedrock orchestrator acting as a real MCP client over Streamable HTTP with OAuth tokens.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)
- **Used for:**
  - `McpServer.registerTool` and `registerResource`;
  - `StreamableHTTPServerTransport` in stateless JSON mode;
  - the `Client` with `StreamableHTTPClientTransport` in the simulator.
- **What worked:** stateless mode is just `sessionIdGenerator: undefined, enableJsonResponse: true`. Protocol negotiation handled Alexa+'s 2025-03-26 out of the box. Zod 4 support, `structuredContent` and annotations all worked first time.
- **What needs work:**
  - Input validation errors come back as `Input validation error: Invalid arguments for tool X: …`, which is fine for an IDE but bad for a voice assistant to read aloud. We had to override an internal method (`createToolError`) to make them speakable. A public hook would help.
  - `req.auth` is claimed by the SDK's `AuthInfo` type, so our own Express auth property collided with it.
- **Would build with it again:** yes, without hesitation.

## MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3)
- **Used for:** the spec types and MIME type for the Echo Show cards.
- **What needs work:** the 2.x server helpers are typed against the v2 MCP packages and don't type-check with the v1 `McpServer`. Bundling the `App` class produced a 590 KiB card. We hand-wrote the ~40-line postMessage handshake instead, and the card is 3 KiB.
- **Would build with it again:** yes, once the SDK versions line up.

## Amazon Bedrock (Converse API)
- **Used for:** the family digest (Claude Haiku 4.5 via the `au.` inference profile, falling back to Nova Lite via `apac.`, then a template), and tool-use orchestration in the simulated Alexa+ client.
- **What worked:**
  - The Converse API meant one code path drives both Claude and Nova, so the fallback chain was trivial.
  - Tool use maps one-to-one onto MCP `tools/list` JSON schemas.
  - In production, Nova Lite answered in about 505–534 ms with roughly 280–335 input and 30–33 output tokens. That's fine for an async digest and would be far too slow for the voice path, which is why it's off it.
- **What needs work:**
  - Before account verification finished, every call returned "your account is currently being verified".
  - After verification, Claude returned `ResourceNotFoundException: Model use case details have not been submitted`. That's a misleading error type for a form that hasn't been filled in.
  - Nova Lite twice claimed a dose was "missed" when it was only due, even with an explicit prompt rule. Our deterministic post-check caught both.
- **Onboarding:** smooth once access existed. The access gates are the hard part.
- **Would build with it again:** yes, but always with a deterministic check on the output for anything a family will act on.

## AWS Lambda, Amazon DynamoDB, EventBridge Scheduler, Amazon SNS, SSM Parameter Store, AWS SAM
- **Used for:** see the AWS table in DEVPOST.md. Deployed to ap-southeast-2, the project's region.
- **What worked:**
  - `sam validate --lint` passed first time, and `sam deploy --resolve-s3` created the stack (3 Lambdas, Function URL, table, topic, schedule, IAM roles) in one go.
  - The `ScheduleV2` event type turns EventBridge Scheduler into four lines of YAML, and it fired every 10 minutes from the first deploy.
  - DynamoDB conditional writes gave us idempotent dose logging and per-incident alert dedupe with no extra infrastructure.
  - Server-side tool time measured from CloudWatch logs was 8–39 ms at p50 and 17–68 ms at p95 across all tools on DynamoDB.
  - SNS delivered the red-flag email on the first try.
- **What needs work:**
  - SNS direct SMS has no resource ARN, so least-privilege IAM is impossible for that action.
  - India SMS needs DLT sender registration, so we used email.
  - Lambda + serverless-http + the MCP SDK returned 415 on every call until we filled `rawHeaders` (friction item 10).
  - On a brand-new standalone account, every service failed with a different error code (`SubscriptionRequiredException`, `OptInRequired`, `NotSignedUp`) until activation finished.
  - The new-experience project's single-region constraint wasn't visible from the CLI.
- **Onboarding:** the Agent Toolkit for AWS setup (`aws configure agent-toolkit`) was quick, and its starter rules were what told us about the region lock.
- **Would build with it again:** yes. The whole backend costs cents a day at demo scale.
