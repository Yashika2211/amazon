import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { pkceChallenge, randomToken } from "../src/oauth/crypto.js";
import { ALEXA_REDIRECT, ALEXA_SECRET, BASE, harness, rpc, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const RESOURCE = `${BASE}/mcp`;

function authorizeParams(verifier: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: "alexa-kinloop",
    redirect_uri: ALEXA_REDIRECT,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    state: "xyz-state",
    scope: "kinloop",
    resource: RESOURCE,
    ...extra,
  };
}

async function login(verifier: string, username = "kamala", pin = "1111", extra: Record<string, string> = {}) {
  return request(h.app)
    .post("/oauth/authorize")
    .type("form")
    .send({ ...authorizeParams(verifier, extra), username, pin });
}

async function getCode(verifier: string, username?: string, pin?: string) {
  const res = await login(verifier, username, pin);
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.location!);
  expect(loc.origin + loc.pathname).toBe(ALEXA_REDIRECT);
  expect(loc.searchParams.get("state")).toBe("xyz-state");
  return loc.searchParams.get("code")!;
}

function token(form: Record<string, string>, basic = true) {
  const req = request(h.app).post("/oauth/token").type("form");
  if (basic) req.set("Authorization", `Basic ${Buffer.from(`alexa-kinloop:${ALEXA_SECRET}`).toString("base64")}`);
  return req.send(form);
}

describe("discovery", () => {
  it("serves RFC 9728 protected resource metadata", async () => {
    const res = await request(h.app).get("/.well-known/oauth-protected-resource");
    expect(res.body).toEqual(
      expect.objectContaining({ resource: RESOURCE, authorization_servers: [BASE], scopes_supported: ["kinloop"], bearer_methods_supported: ["header"] }),
    );
  });

  it("serves RFC 8414 authorization server metadata with S256", async () => {
    const res = await request(h.app).get("/.well-known/oauth-authorization-server");
    expect(res.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res.body.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(res.body.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(res.body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(res.body.registration_endpoint).toBeUndefined();
  });

  it("returns 401 with no WWW-Authenticate header when unauthenticated", async () => {
    const res = await rpc(h.app, undefined, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
    expect(res.body).toEqual({ error: "unauthorized", message: expect.any(String) });
    const bad = await rpc(h.app, "kla_not-a-real-token", "tools/list");
    expect(bad.status).toBe(401);
    expect(bad.headers["www-authenticate"]).toBeUndefined();
  });

  it("refuses bearer tokens in the query string", async () => {
    const res = await request(h.app).post("/mcp?access_token=abc").send({});
    expect(res.status).toBe(400);
  });
});

describe("authorization code + PKCE flow", () => {
  it("links an account end to end and the token works on /mcp", async () => {
    const page = await request(h.app).get("/oauth/authorize").query(authorizeParams(randomToken()));
    expect(page.status).toBe(200);
    expect(page.text).toContain("Link Alexa to KinLoop");

    const verifier = randomToken();
    const code = await getCode(verifier);
    const res = await token({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier, resource: RESOURCE, client_id: "alexa-kinloop" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(res.body.refresh_token).toBeTruthy();

    const list = await rpc(h.app, res.body.access_token, "tools/list");
    expect(list.status).toBe(200);
    expect(list.body.result.tools.length).toBe(10);
  });

  it("stores only hashes of codes and tokens", async () => {
    const verifier = randomToken();
    const code = await getCode(verifier);
    const res = await token({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier, resource: RESOURCE });
    const dump = JSON.stringify([...(h.deps.table as any).items.values()]);
    expect(dump).not.toContain(res.body.access_token);
    expect(dump).not.toContain(res.body.refresh_token);
    expect(dump).not.toContain(code);
  });

  it("supports client_secret_post as well as HTTP Basic", async () => {
    const verifier = randomToken();
    const code = await getCode(verifier);
    const res = await token(
      { grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier, client_id: "alexa-kinloop", client_secret: ALEXA_SECRET },
      false,
    );
    expect(res.status).toBe(200);
  });

  it("refreshes without a resource parameter (as Alexa+ does) and rotates the refresh token", async () => {
    const verifier = randomToken();
    const code = await getCode(verifier);
    const first = await token({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier, resource: RESOURCE });
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: first.body.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(first.body.refresh_token);
    expect((await rpc(h.app, refreshed.body.access_token, "tools/list")).status).toBe(200);
    const reuse = await token({ grant_type: "refresh_token", refresh_token: first.body.refresh_token });
    expect(reuse.body.error).toBe("invalid_grant");
  });

  it("rejects a wrong PKCE verifier, and codes are single-use", async () => {
    const verifier = randomToken();
    const code = await getCode(verifier);
    const wrong = await token({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: randomToken() });
    expect(wrong.body.error).toBe("invalid_grant");
    // The failed attempt consumed the code.
    const retry = await token({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier });
    expect(retry.body.error).toBe("invalid_grant");
  });

  it("rejects a bad client secret and mismatched redirect or resource", async () => {
    const verifier = randomToken();
    const code = await getCode(verifier);
    const badSecret = await request(h.app)
      .post("/oauth/token")
      .type("form")
      .set("Authorization", `Basic ${Buffer.from("alexa-kinloop:nope").toString("base64")}`)
      .send({ grant_type: "authorization_code", code, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier });
    expect(badSecret.status).toBe(401);
    expect(badSecret.body.error).toBe("invalid_client");

    const code2 = await getCode(verifier);
    const wrongRedirect = await token({ grant_type: "authorization_code", code: code2, redirect_uri: "https://evil.example/cb", code_verifier: verifier });
    expect(wrongRedirect.body.error).toBe("invalid_grant");

    const code3 = await getCode(verifier);
    const wrongResource = await token({ grant_type: "authorization_code", code: code3, redirect_uri: ALEXA_REDIRECT, code_verifier: verifier, resource: "https://other.example/mcp" });
    expect(wrongResource.body.error).toBe("invalid_target");
  });

  it("never redirects to an unregistered redirect_uri", async () => {
    const res = await request(h.app).get("/oauth/authorize").query(authorizeParams(randomToken(), { redirect_uri: "https://evil.example/cb" }));
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it("requires S256 PKCE and the right resource", async () => {
    const plain = await request(h.app).get("/oauth/authorize").query(authorizeParams(randomToken(), { code_challenge_method: "plain" }));
    expect(plain.status).toBe(302);
    expect(new URL(plain.headers.location!).searchParams.get("error")).toBe("invalid_request");
    const res = await request(h.app).get("/oauth/authorize").query(authorizeParams(randomToken(), { resource: "https://other.example/mcp" }));
    expect(new URL(res.headers.location!).searchParams.get("error")).toBe("invalid_target");
  });

  it("shows an error for a wrong PIN and rate-limits guessing", async () => {
    const res = await login(randomToken(), "kamala", "9999");
    expect(res.status).toBe(401);
    expect(res.text).toContain("don&#39;t match");
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await login(randomToken(), "kamala", "9999")).status;
    expect(last).toBe(429);
  });

  it("dashboard is a public PKCE client and needs no secret", async () => {
    const verifier = randomToken();
    const res = await request(h.app)
      .post("/oauth/authorize")
      .type("form")
      .send({ ...authorizeParams(verifier), client_id: "kinloop-dashboard", redirect_uri: `${BASE}/callback/`, username: "arjun", pin: "2222" });
    const code = new URL(res.headers.location!).searchParams.get("code")!;
    const tok = await request(h.app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "authorization_code", code, redirect_uri: `${BASE}/callback/`, code_verifier: verifier, client_id: "kinloop-dashboard" });
    expect(tok.status).toBe(200);
    const dash = await request(h.app).get("/api/dashboard").set("Authorization", `Bearer ${tok.body.access_token}`);
    expect(dash.status).toBe(200);
    expect(dash.body.elderName).toBe("Kamala");
    expect(dash.body.timeline).toBeInstanceOf(Array);
  });
});
