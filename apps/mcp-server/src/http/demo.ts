import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import express, { type Router } from "express";
import { localParts } from "@kinloop/core";
import { z } from "zod";
import { log } from "../log.js";
import { randomToken, sha256 } from "../oauth/crypto.js";
import { baseUrlOf, resourceOf, SCOPE } from "../oauth/router.js";
import { DEMO, seedDemo, wipeDemo } from "../store/seed.js";
import type { Deps } from "../services/deps.js";
import { escalateHousehold } from "../services/escalation.js";
import { simulateTurn } from "../services/simulator.js";
import { rateLimit } from "./rateLimit.js";

/**
 * Demo-only endpoints (DEMO_MODE=true). They only ever touch the fictional demo household.
 * Tokens minted here are ordinary OAuth access tokens scoped to that household.
 */
export function demoRouter(deps: Deps): Router {
  const r = express.Router();
  r.use(express.json({ limit: "32kb" }));
  r.use(rateLimit({ name: "demo", windowMs: 60_000, max: 120 }));
  const bedrock = process.env.SIM_ORCHESTRATOR === "keyword" ? undefined : new BedrockRuntimeClient({ region: deps.config.awsRegion });

  const mint = async (memberId: string, role: "elder" | "caregiver", resource: string) => {
    const token = randomToken("kla_");
    await deps.store.putAccessToken(sha256(token), {
      clientId: "kinloop-demo-simulator",
      scope: SCOPE,
      resource,
      householdId: DEMO.householdId,
      memberId,
      role,
      expiresAt: Date.now() + 2 * 3600 * 1000,
    });
    return token;
  };

  r.post("/reset", async (_req, res) => {
    await wipeDemo(deps.table);
    await seedDemo(deps.store, {
      now: deps.clock.now(),
      ...(process.env.DEMO_CAREGIVER_EMAIL ? { caregiverEmail: process.env.DEMO_CAREGIVER_EMAIL } : {}),
      ...(process.env.DEMO_CAREGIVER_PHONE ? { caregiverPhone: process.env.DEMO_CAREGIVER_PHONE } : {}),
      ...(process.env.DEMO_CAREGIVER_TELEGRAM_CHAT_ID ? { caregiverTelegramChatId: process.env.DEMO_CAREGIVER_TELEGRAM_CHAT_ID } : {}),
    });
    log.info("demo.reset");
    res.json({ ok: true });
  });

  /** Tokens for the two simulator panes: Kamala's kitchen and Arjun in Bengaluru. */
  r.post("/session", async (req, res) => {
    const resource = resourceOf(req, deps);
    res.setHeader("Cache-Control", "no-store").json({
      elder: await mint(DEMO.elderId, "elder", resource),
      caregiver: await mint(DEMO.caregiverId, "caregiver", resource),
      mcpUrl: resource,
    });
  });

  r.post("/turn", async (req, res) => {
    try {
      const input = z
        .object({
          persona: z.enum(["elder", "caregiver"]),
          text: z.string().trim().min(1).max(400),
          token: z.string().min(10).max(200),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1000) })).max(12).default([]),
          pending: z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) }).optional(),
        })
        .parse(req.body);
      // Always go back out over HTTP to our own public /mcp URL, so the simulator exercises the real
      // MCP server and the token's audience matches.
      const mcpUrl = `${baseUrlOf(req, deps)}/mcp`;
      const result = await simulateTurn(input, {
        mcpUrl,
        token: input.token,
        bedrock: bedrock
          ? { client: bedrock, modelIds: process.env.SIM_MODEL_ID ? [process.env.SIM_MODEL_ID] : [deps.config.bedrockModelId, deps.config.bedrockFallbackModelId] }
          : undefined,
      });
      res.json(result);
    } catch (err) {
      log.error("demo.turn_failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(400).json({ error: "turn_failed", message: "The simulator couldn't complete that turn." });
    }
  });

  /** Runs the scheduled escalation pass right now (what EventBridge Scheduler does every 10 minutes). */
  r.post("/escalate", async (_req, res) => {
    res.json(await escalateHousehold(deps, DEMO.householdId));
  });

  /** Live alert feed for the "phone" in the simulator. */
  r.get("/feed", async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : new Date(Date.now() - 3600_000).toISOString();
    const alerts = await deps.store.listAlerts(DEMO.householdId, since);
    const digest = await deps.store.getDigest(DEMO.householdId, localParts(deps.clock.now(), "Asia/Kolkata").date);
    res.setHeader("Cache-Control", "no-store").json({
      alerts: alerts.map((a) => ({ incidentKey: a.incidentKey, kind: a.kind, severity: a.severity, reason: a.reason, details: a.details, at: a.createdAt })),
      digest: digest ? { text: digest.text, modelId: digest.modelId, latencyMs: digest.latencyMs, generatedAt: digest.generatedAt, inputTokens: digest.inputTokens, outputTokens: digest.outputTokens } : null,
      now: deps.clock.now().toISOString(),
    });
  });

  return r;
}
