import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CARD_HTML } from "./ui-html.generated.js";

/** MCP Apps resource MIME type (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/** MCP Apps UI resources for Echo Show: large text and status chips. */
export const UI = {
  todayPlan: "ui://kinloop/today-plan",
  parentStatus: "ui://kinloop/parent-status",
} as const;

export function registerUiResources(server: McpServer): void {
  for (const [name, uri] of [
    ["today-plan-card", UI.todayPlan],
    ["parent-status-card", UI.parentStatus],
  ] as const) {
    server.registerResource(
      name,
      uri,
      { title: name === "today-plan-card" ? "Today's plan" : "Parent status", description: "Echo Show card with large text and status chips", mimeType: MCP_APP_MIME },
      async () => ({ contents: [{ uri, mimeType: MCP_APP_MIME, text: CARD_HTML }] }),
    );
  }
}
