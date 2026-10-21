import { existsSync } from "node:fs";
import express, { type Express, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createMcpServer } from "../mcp/server.js";
import { oauthRouter, requireBearer, type SecretSource } from "../oauth/router.js";
import { log } from "../log.js";
import type { Deps } from "../services/deps.js";
import { createHousehold, dashboardData } from "../services/dashboard.js";
import { sendMessageToParent, SpokenError } from "../services/kinloop.js";
import { rateLimit } from "./rateLimit.js";
import { demoRouter } from "./demo.js";

export interface AppOptions {
  deps: Deps;
  secrets: SecretSource;
  /** Directory with the statically exported web app (apps/web/out). */
  staticDir?: string;
}

function apiError(res: Response, err: unknown): void {
  if (err instanceof SpokenError) {
    const status = err.code === "forbidden" ? 403 : err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
    res.status(status).json({ error: err.code, message: err.speech });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "invalid_request", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return;
  }
  log.error("api.failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "internal_error", message: "Something went wrong. Please try again." });
}

export function createApp({ deps, secrets, staticDir }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const started = Date.now();
    res.on("finish", () => {
      if (req.path !== "/health") log.info("http", { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "kinloop" });
  });

  app.use(oauthRouter(deps, secrets));

  // ---- MCP: Streamable HTTP, stateless, JSON responses ----
  const bearer = requireBearer(deps);
  app.post("/mcp", express.json({ limit: "256kb" }), bearer, async (req: Request, res: Response) => {
    const server = createMcpServer(deps, req.kinloop!);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp.failed", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });
  // Stateless server: no standalone SSE stream and no sessions to delete.
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).setHeader("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // Demo routes first: the /api router below requires a bearer token for everything under it.
  if (deps.config.demoMode) app.use("/api/demo", demoRouter(deps));

  // ---- Dashboard API ----
  const api = express.Router();
  api.use(express.json({ limit: "32kb" }));

  api.post(
    "/households",
    rateLimit({ name: "setup", windowMs: 60_000, max: 5 }),
    async (req, res) => {
      try {
        const pin = z.string().regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits");
        const name = z.string().trim().min(1).max(40);
        const username = z.string().trim().regex(/^[a-zA-Z0-9._-]{3,32}$/, "3 to 32 letters, numbers, dots or dashes");
        const input = z
          .object({
            householdName: z.string().trim().min(1).max(60),
            timezone: z.string().min(3).max(60),
            emergencyNumber: z.string().regex(/^\d{2,4}$/),
            checkInDeadline: z.string(),
            elderName: name,
            elderUsername: username,
            elderPin: pin,
            caregiverName: name,
            caregiverRelation: z.string().trim().max(20).optional(),
            caregiverUsername: username,
            caregiverPin: pin,
            caregiverEmail: z.string().email().optional(),
          })
          .parse(req.body);
        res.status(201).json(await createHousehold(deps, input));
      } catch (err) {
        apiError(res, err);
      }
    },
  );

  api.use(bearer);
  api.get("/me", async (req, res) => {
    const member = await deps.store.getMember(req.kinloop!.householdId, req.kinloop!.memberId);
    res.json({ member, role: req.kinloop!.role });
  });
  api.get("/dashboard", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store").json(await dashboardData(deps, req.kinloop!));
    } catch (err) {
      apiError(res, err);
    }
  });
  api.post("/messages", async (req, res) => {
    try {
      const { text } = z.object({ text: z.string().trim().min(1).max(300) }).parse(req.body);
      res.status(201).json((await sendMessageToParent(deps, req.kinloop!, { text })).data);
    } catch (err) {
      apiError(res, err);
    }
  });
  api.post("/alerts/:key/ack", async (req, res) => {
    if (req.kinloop!.role !== "caregiver") {
      res.status(403).json({ error: "forbidden", message: "Only family members can acknowledge alerts." });
      return;
    }
    const ok = await deps.store.acknowledgeAlert(req.kinloop!.householdId, String(req.params.key), new Date().toISOString());
    res.status(ok ? 200 : 404).json({ acknowledged: ok });
  });
  app.use("/api", api);

  // ---- Static web app (dashboard, simulator, privacy, terms) ----
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { extensions: ["html"], index: "index.html", maxAge: "5m" }));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "Not found." });
  });
  return app;
}
