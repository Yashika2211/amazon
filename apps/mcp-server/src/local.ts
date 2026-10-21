import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeps, secretsFrom } from "./bootstrap.js";
import { createApp } from "./http/app.js";
import { log } from "./log.js";
import { escalateHousehold } from "./services/escalation.js";
import { DEMO, seedDemo } from "./store/seed.js";

/** Local server: in-memory store seeded with the demo household, unless TABLE_NAME points at DynamoDB. */
process.env.DEMO_MODE ??= "true";
const port = Number(process.env.PORT ?? 8787);
process.env.PORT = String(port);
const deps = buildDeps();
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? join(here, "../../web/out");

if (!deps.config.tableName) {
  await seedDemo(deps.store, { now: deps.clock.now() });
  log.info("local.seeded", { householdId: DEMO.householdId });
}

const app = createApp({ deps, secrets: secretsFrom(deps.config), staticDir });
app.listen(port, () => {
  console.log(`\nKinLoop running at http://localhost:${port}`);
  console.log(`  MCP endpoint:   http://localhost:${port}/mcp`);
  console.log(`  Dashboard:      http://localhost:${port}/`);
  console.log(`  Simulator:      http://localhost:${port}/simulator/`);
  console.log(`  Demo logins:    kamala / ${DEMO.elderPin}   arjun / ${DEMO.caregiverPin}\n`);
});

// Same cadence as the EventBridge schedule in AWS.
setInterval(() => {
  void deps.store.listHouseholdIds().then((ids) => Promise.all(ids.map((id) => escalateHousehold(deps, id))));
}, 10 * 60 * 1000).unref();
