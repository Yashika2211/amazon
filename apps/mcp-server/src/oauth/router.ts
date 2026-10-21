import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Deps } from "../services/deps.js";
import type { AuthContext } from "../services/kinloop.js";
import { log } from "../log.js";
import { rateLimit } from "../http/rateLimit.js";
import { buildClients, type OAuthClient } from "./clients.js";
import { isValidVerifier, pkceChallenge, randomToken, safeEqual, sha256, verifyPin } from "./crypto.js";
import { errorPage, loginPage } from "./pages.js";
import type { TokenRecord } from "../store/store.js";

export const SCOPE = "kinloop";
const CODE_TTL_MS = 5 * 60 * 1000;

export function baseUrlOf(req: Request, deps: Pick<Deps, "config">): string {
  if (deps.config.publicBaseUrl) return deps.config.publicBaseUrl;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host;
  return `${proto}://${host}`;
}

/** The MCP server's canonical resource URI (RFC 8707 / RFC 9728). */
export function resourceOf(req: Request, deps: Pick<Deps, "config">): string {
  return `${baseUrlOf(req, deps)}/mcp`;
}

function sameResource(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

export interface SecretSource {
  alexaClientSecret(): Promise<string | undefined>;
}

/** RFC 6749 §5.2 error response. */
function tokenError(res: Response, status: number, error: string, description: string): void {
  res.status(status).setHeader("Cache-Control", "no-store").json({ error, error_description: description });
}

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  resource: string;
}

const PARAM_KEYS: Array<keyof AuthorizeParams> = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

function readParams(source: Record<string, unknown>): AuthorizeParams {
  const out = {} as AuthorizeParams;
  for (const k of PARAM_KEYS) out[k] = typeof source[k] === "string" ? (source[k] as string) : "";
  return out;
}

type Validated =
  | { ok: true; client: OAuthClient; params: AuthorizeParams }
  | { ok: false; redirect?: string; page?: string };

function redirectWith(uri: string, query: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(query)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export function oauthRouter(deps: Deps, secrets: SecretSource): Router {
  const router = express.Router();
  const clientsFor = (req: Request) => buildClients(deps.config, baseUrlOf(req, deps), () => secrets.alexaClientSecret());

  // ---- RFC 9728 Protected Resource Metadata ----
  const prm = (req: Request, res: Response) => {
    res.json({
      resource: resourceOf(req, deps),
      authorization_servers: [baseUrlOf(req, deps)],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "KinLoop",
      resource_documentation: `${baseUrlOf(req, deps)}/`,
    });
  };
  router.get("/.well-known/oauth-protected-resource", prm);
  router.get("/.well-known/oauth-protected-resource/mcp", prm);

  // ---- RFC 8414 Authorization Server Metadata ----
  router.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = baseUrlOf(req, deps);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      scopes_supported: [SCOPE],
      service_documentation: `${base}/`,
    });
  });

  function validate(req: Request, p: AuthorizeParams): Validated {
    const client = clientsFor(req).get(p.client_id);
    // Errors before the redirect URI is trusted are shown on our page, never redirected (RFC 6749 §4.1.2.1).
    if (!client) return { ok: false, page: "This app isn't registered with KinLoop." };
    if (!p.redirect_uri || !client.redirectAllowed(p.redirect_uri)) {
      log.warn("oauth.redirect_rejected", { clientId: p.client_id });
      return { ok: false, page: "The return address for this app isn't registered with KinLoop." };
    }
    const fail = (error: string, description: string): Validated => ({
      ok: false,
      redirect: redirectWith(p.redirect_uri, { error, error_description: description, state: p.state }),
    });
    if (p.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
    if (!p.code_challenge || p.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) return fail("invalid_request", "code_challenge must be a base64url SHA-256.");
    if (p.resource && !sameResource(p.resource, resourceOf(req, deps))) return fail("invalid_target", "Unknown resource.");
    if (p.scope && !p.scope.split(" ").every((s) => s === SCOPE)) return fail("invalid_scope", `Supported scope: ${SCOPE}.`);
    return { ok: true, client, params: p };
  }

  router.get("/oauth/authorize", (req, res) => {
    const p = readParams(req.query as Record<string, unknown>);
    const v = validate(req, p);
    if (!v.ok) {
      if (v.redirect) return res.redirect(302, v.redirect);
      return res.status(400).type("html").send(errorPage(v.page!));
    }
    res
      .setHeader("Cache-Control", "no-store")
      .setHeader("X-Frame-Options", "DENY")
      .setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'")
      .type("html")
      .send(loginPage({ clientName: v.client.name, params: { ...v.params }, demoHint: deps.config.demoMode }));
  });

  router.post(
    "/oauth/authorize",
    rateLimit({ name: "authorize", windowMs: 60_000, max: 10 }),
    express.urlencoded({ extended: false, limit: "8kb" }),
    async (req, res) => {
      const p = readParams(req.body ?? {});
      const v = validate(req, p);
      if (!v.ok) {
        if (v.redirect) return res.redirect(302, v.redirect);
        return res.status(400).type("html").send(errorPage(v.page!));
      }
      const username = String(req.body.username ?? "").trim();
      const pin = String(req.body.pin ?? "");
      const cred = username ? await deps.store.getCredential(username) : undefined;
      if (!cred || !verifyPin(pin, cred.pinHash)) {
        log.warn("oauth.login_failed");
        return res
          .status(401)
          .type("html")
          .send(loginPage({ clientName: v.client.name, params: { ...p }, error: "That name and PIN don't match. Please try again.", demoHint: deps.config.demoMode }));
      }
      const member = await deps.store.getMember(cred.householdId, cred.memberId);
      if (!member) return res.status(400).type("html").send(errorPage("This KinLoop profile no longer exists."));

      const code = randomToken("klc_");
      await deps.store.putAuthCode(sha256(code), {
        clientId: v.client.id,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        ...(p.resource ? { resource: p.resource } : {}),
        scope: SCOPE,
        householdId: member.householdId,
        memberId: member.id,
        role: member.role,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      log.info("oauth.code_issued", { clientId: v.client.id, role: member.role });
      res.redirect(302, redirectWith(p.redirect_uri, { code, state: p.state }));
    },
  );

  // ---- Token endpoint ----
  router.post(
    "/oauth/token",
    rateLimit({ name: "token", windowMs: 60_000, max: 60 }),
    express.urlencoded({ extended: false, limit: "8kb" }),
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, string>;
      // Client authentication: HTTP Basic, or client_id/client_secret in the form body.
      let clientId = body.client_id;
      let clientSecret = body.client_secret;
      const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? "");
      if (basic) {
        const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
        const i = decoded.indexOf(":");
        clientId = decodeURIComponent(decoded.slice(0, i));
        clientSecret = decodeURIComponent(decoded.slice(i + 1));
      }
      const client = clientId ? clientsFor(req).get(clientId) : undefined;
      if (!client) return tokenError(res, 401, "invalid_client", "Unknown client.");
      if (client.confidential && !(clientSecret && (await client.verifySecret!(clientSecret)))) {
        log.warn("oauth.client_auth_failed", { clientId });
        return tokenError(res, 401, "invalid_client", "Client authentication failed.");
      }

      const issue = async (base: Omit<TokenRecord, "expiresAt">) => {
        const access = randomToken("kla_");
        const refresh = randomToken("klr_");
        const now = Date.now();
        await deps.store.putAccessToken(sha256(access), { ...base, expiresAt: now + deps.config.accessTokenTtlSec * 1000 });
        await deps.store.putRefreshToken(sha256(refresh), { ...base, expiresAt: now + deps.config.refreshTokenTtlSec * 1000 });
        log.info("oauth.token_issued", { clientId: base.clientId, role: base.role });
        res.setHeader("Cache-Control", "no-store").setHeader("Pragma", "no-cache").json({
          access_token: access,
          token_type: "Bearer",
          expires_in: deps.config.accessTokenTtlSec,
          refresh_token: refresh,
          scope: base.scope,
        });
      };

      if (body.grant_type === "authorization_code") {
        if (!body.code || !body.code_verifier || !body.redirect_uri) {
          return tokenError(res, 400, "invalid_request", "code, code_verifier and redirect_uri are required.");
        }
        const rec = await deps.store.consumeAuthCode(sha256(body.code));
        if (!rec || rec.clientId !== client.id) return tokenError(res, 400, "invalid_grant", "The code is invalid, expired or already used.");
        if (rec.redirectUri !== body.redirect_uri) return tokenError(res, 400, "invalid_grant", "redirect_uri does not match.");
        if (!isValidVerifier(body.code_verifier) || !safeEqual(pkceChallenge(body.code_verifier), rec.codeChallenge)) {
          return tokenError(res, 400, "invalid_grant", "PKCE verification failed.");
        }
        if (body.resource && !sameResource(body.resource, resourceOf(req, deps))) {
          return tokenError(res, 400, "invalid_target", "Unknown resource.");
        }
        if (rec.resource && body.resource && !sameResource(rec.resource, body.resource)) {
          return tokenError(res, 400, "invalid_target", "resource does not match the authorization request.");
        }
        const resource = body.resource || rec.resource;
        return issue({
          clientId: rec.clientId,
          scope: rec.scope,
          ...(resource ? { resource } : {}),
          householdId: rec.householdId,
          memberId: rec.memberId,
          role: rec.role,
        });
      }

      if (body.grant_type === "refresh_token") {
        if (!body.refresh_token) return tokenError(res, 400, "invalid_request", "refresh_token is required.");
        // Alexa+ omits `resource` on refresh; the original audience carries over. Refresh tokens rotate.
        const rec = await deps.store.consumeRefreshToken(sha256(body.refresh_token));
        if (!rec || rec.clientId !== client.id) return tokenError(res, 400, "invalid_grant", "The refresh token is invalid or expired.");
        const { expiresAt: _e, ...base } = rec;
        return issue(base);
      }

      return tokenError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
    },
  );

  return router;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      kinloop?: AuthContext;
    }
  }
}

/**
 * Bearer authentication for /mcp and /api. Unauthenticated requests get 401 with a JSON body and
 * deliberately no WWW-Authenticate header, as Alexa+ requires. Tokens in the query string are refused.
 */
export function requireBearer(deps: Deps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if ("access_token" in (req.query ?? {})) {
      res.status(400).json({ error: "invalid_request", message: "Send the access token in the Authorization header, not the URL." });
      return;
    }
    const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(req.headers.authorization ?? "");
    const rec = m ? await deps.store.getAccessToken(sha256(m[1]!)) : undefined;
    if (!rec) {
      res.status(401).json({ error: "unauthorized", message: "Please link your KinLoop account." });
      return;
    }
    if (rec.resource && !sameResource(rec.resource, resourceOf(req, deps))) {
      res.status(401).json({ error: "invalid_token", message: "This token was issued for a different server." });
      return;
    }
    req.kinloop = { householdId: rec.householdId, memberId: rec.memberId, role: rec.role, clientId: rec.clientId };
    next();
  };
}
