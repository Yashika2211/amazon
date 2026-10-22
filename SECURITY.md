# Security and privacy

KinLoop handles health-adjacent data for older adults, so the design assumes mistakes are costly. This page lists the threats we considered and the controls that address them, each linked to its code or test.

## Reporting a vulnerability

Please open a private security advisory on this repository, or an issue without exploit details, and we'll respond within 72 hours.

## Threat model

| Threat | Control | Where |
|---|---|---|
| Someone reads another household's data | Every store method takes the household ID from the verified access token, never from tool arguments. A test proves cross-household reads and writes fail, including a forged token whose member belongs to another household. | [`store.ts`](apps/mcp-server/src/store/store.ts), [`mcp.test.ts`](apps/mcp-server/test/mcp.test.ts) "household isolation" |
| Stolen database contents reveal tokens | Authorization codes, access tokens and refresh tokens are stored only as SHA-256 hashes. PINs are salted scrypt. A test dumps the table and asserts no plaintext token appears. | [`crypto.ts`](apps/mcp-server/src/oauth/crypto.ts), [`oauth.test.ts`](apps/mcp-server/test/oauth.test.ts) |
| Authorization code interception | PKCE with S256 only (`plain` is rejected), single-use codes with a 5-minute expiry, and an exact-match `redirect_uri` against a static allowlist. Errors before the redirect is trusted are shown on our page, never redirected. | [`router.ts`](apps/mcp-server/src/oauth/router.ts) |
| Token replay against another server | Tokens are bound to the `resource` (RFC 8707). Requests whose token audience doesn't match this server are rejected. | `requireBearer` in [`router.ts`](apps/mcp-server/src/oauth/router.ts) |
| Long-lived token theft | 1-hour access tokens. Refresh tokens rotate on every use, and reuse fails. | [`store.ts`](apps/mcp-server/src/store/store.ts) |
| Tokens leaking through URLs and logs | Bearer tokens are accepted only in the `Authorization` header; query-string tokens get a 400. Token endpoint responses are `Cache-Control: no-store`. | [`router.ts`](apps/mcp-server/src/oauth/router.ts) |
| PIN guessing | 10 login attempts per minute per IP, then 429. | [`rateLimit.ts`](apps/mcp-server/src/http/rateLimit.ts) |
| Clickjacking of the consent page | `X-Frame-Options: DENY`, and a CSP with `frame-ancestors 'none'` and `form-action` limited. | [`router.ts`](apps/mcp-server/src/oauth/router.ts) |
| Health data in logs | A structured logger redacts `note`, `text`, `symptom`, `message`, `pin`, `code` and token fields before writing. | [`log.ts`](apps/mcp-server/src/log.ts) |
| Internal details in errors | A final JSON error handler. A test asserts no stack trace or file path reaches the client. Tool errors are short spoken sentences. | [`app.ts`](apps/mcp-server/src/http/app.ts) |
| An LLM tells the family something false | No LLM decides alerts; the rules are pure functions with 100% coverage. Every Bedrock digest passes a deterministic check (no false "missed" claims, no unknown medicines, no advice, no dropped red flags) before it's stored. Otherwise the template is used. This caught a real Nova Lite error in production. | [`rules/`](packages/core/src/rules), `checkDigest` in [`digest.ts`](apps/mcp-server/src/services/digest.ts) |
| Destructive changes by voice mishearing | `update_medication_schedule` is `destructiveHint: true` and needs a second call with `confirm: true` after a spoken read-back. | [`kinloop.ts`](apps/mcp-server/src/services/kinloop.ts) |
| Over-broad cloud permissions | Per-function IAM: one table, one topic, one digest function, one SSM parameter, and Bedrock limited to Claude and Nova. The exception is SNS direct SMS, which has no resource ARN. Secrets live in SSM SecureString. | [`template.yaml`](infra/template.yaml) |
| Data kept longer than needed | DynamoDB TTL: 90 days for health records, 30 for messages, and token lifetimes for OAuth artifacts. Stated on the privacy page. | [`store.ts`](apps/mcp-server/src/store/store.ts), `/privacy/` |

## Known limits

- Rate limiting is per Lambda instance. AWS WAF on the Function URL (via CloudFront) is the production upgrade.
- Demo mode (`DEMO_MODE=true`) exposes token minting and reset endpoints for the **fictional demo household only**. Turn it off for real households.
- KinLoop is not a medical device and does not replace emergency services.
