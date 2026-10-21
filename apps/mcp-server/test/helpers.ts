import request from "supertest";
import type { Express } from "express";
import { loadConfig } from "../src/config.js";
import { buildDeps } from "../src/bootstrap.js";
import { createApp } from "../src/http/app.js";
import { randomToken, sha256 } from "../src/oauth/crypto.js";
import { FixedClock } from "../src/services/clock.js";
import { ConsoleNotifier } from "../src/services/notifier.js";
import { templateWriter } from "../src/services/digest.js";
import type { Deps } from "../src/services/deps.js";
import { DEMO, seedDemo } from "../src/store/seed.js";
import { MemoryTable } from "../src/store/table.js";

export const ALEXA_SECRET = "test-alexa-secret-value";
export const ALEXA_REDIRECT = "https://pitangui.amazon.com/api/skill/link/TESTVENDOR";
export const BASE = "http://127.0.0.1";

export interface Harness {
  app: Express;
  deps: Deps;
  clock: FixedClock;
  notifier: ConsoleNotifier;
}

/** 08:20 IST on 2026-10-21. */
export const DEMO_NOW = new Date("2026-10-21T02:50:00Z");

export async function harness(now = DEMO_NOW): Promise<Harness> {
  const clock = new FixedClock(now);
  const notifier = new ConsoleNotifier();
  const config = {
    ...loadConfig({
      ALEXA_CLIENT_ID: "alexa-kinloop",
      ALEXA_CLIENT_SECRET: ALEXA_SECRET,
      ALEXA_REDIRECT_URIS: ALEXA_REDIRECT,
      LOG_LEVEL: "error",
    }),
    publicBaseUrl: BASE,
  };
  const deps = buildDeps({ config, table: new MemoryTable(), clock, notifier, digestWriter: templateWriter });
  await seedDemo(deps.store, { now });
  const app = createApp({ deps, secrets: { alexaClientSecret: async () => ALEXA_SECRET } });
  return { app, deps, clock, notifier };
}

/** Mints an access token directly in the store (OAuth itself is covered in oauth.test.ts). */
export async function tokenFor(deps: Deps, memberId: string, role: "elder" | "caregiver", householdId: string = DEMO.householdId): Promise<string> {
  const token = randomToken("kla_");
  await deps.store.putAccessToken(sha256(token), {
    clientId: "alexa-kinloop",
    scope: "kinloop",
    resource: `${BASE}/mcp`,
    householdId,
    memberId,
    role,
    expiresAt: Date.now() + 3600_000,
  });
  return token;
}

let rpcId = 1;

export async function rpc(app: Express, token: string | undefined, method: string, params: Record<string, unknown> = {}) {
  const req = request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send({ jsonrpc: "2.0", id: rpcId++, method, params });
}

export async function callTool(app: Express, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(app, token, "tools/call", { name, arguments: args });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.text}`);
  return res.body.result as {
    content: Array<{ type: string; text: string }>;
    structuredContent: Record<string, any>;
    isError?: boolean;
    _meta?: Record<string, any>;
  };
}
