import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:8799", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm --filter @kinloop/mcp-server start",
    url: "http://localhost:8799/health",
    reuseExistingServer: false,
    env: { PORT: "8799", DEMO_MODE: "true", DEMO_LOCAL_TIME: "08:20", SIM_ORCHESTRATOR: "keyword", LOG_LEVEL: "warn" },
  },
});
