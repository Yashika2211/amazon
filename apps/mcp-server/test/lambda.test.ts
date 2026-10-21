import serverless from "serverless-http";
import { describe, expect, it } from "vitest";
import { DEMO } from "../src/store/seed.js";
import { harness, tokenFor } from "./helpers.js";

/** Drives the app exactly as production does: a Lambda Function URL event through serverless-http. */
function functionUrlEvent(body: unknown, token: string) {
  const json = JSON.stringify(body);
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/mcp",
    rawQueryString: "",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: { method: "POST", path: "/mcp", protocol: "HTTP/1.1", sourceIp: "203.0.113.9", userAgent: "Alexa+ MCP Client" },
      requestId: "test",
      routeKey: "$default",
      stage: "$default",
      timeEpoch: Date.now(),
    },
    body: Buffer.from(json).toString("base64"),
    isBase64Encoded: true,
  };
}

describe("Lambda Function URL path", () => {
  it("serves MCP initialize and tools/call through serverless-http", async () => {
    const h = await harness();
    const token = await tokenFor(h.deps, DEMO.elderId, "elder");
    const handler = serverless(h.app);

    const init = (await handler(
      functionUrlEvent(
        {
          jsonrpc: "2.0",
          id: "4e3bdaee-0",
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: { roots: { listChanged: true } }, clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" } },
        },
        token,
      ),
      {},
    )) as { statusCode: number; body: string; isBase64Encoded?: boolean };
    const initBody = JSON.parse(init.isBase64Encoded ? Buffer.from(init.body, "base64").toString() : init.body);
    expect(init.statusCode).toBe(200);
    expect(initBody.result.protocolVersion).toBe("2025-03-26");

    const call = (await handler(
      functionUrlEvent({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_today_plan", arguments: {} } }, token),
      {},
    )) as { statusCode: number; body: string; isBase64Encoded?: boolean };
    const callBody = JSON.parse(call.isBase64Encoded ? Buffer.from(call.body, "base64").toString() : call.body);
    expect(call.statusCode).toBe(200);
    expect(callBody.result.content[0].text).toContain("Good morning, Kamala.");
  });
});
