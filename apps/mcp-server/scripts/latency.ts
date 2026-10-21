/**
 * Latency check: real HTTP round trips to /mcp, the way Alexa+ calls it.
 * Usage: pnpm latency [baseUrl] [iterations]   (defaults: http://localhost:8787, 30)
 * Needs DEMO_MODE on the target to mint demo tokens. Exits non-zero if any tool's p95 >= 500 ms.
 */
const base = (process.argv[2] ?? process.env.KINLOOP_URL ?? "http://localhost:8787").replace(/\/$/, "");
const iterations = Number(process.argv[3] ?? 30);
const BUDGET_MS = 500;

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

const session = await post("/api/demo/session", {});
const cases: Array<{ name: string; token: string; args: Record<string, unknown> }> = [
  { name: "get_today_plan", token: session.elder, args: {} },
  { name: "log_medication", token: session.elder, args: { medication: "blood pressure" } },
  { name: "daily_check_in", token: session.elder, args: { mood: 4, sleep: "okay" } },
  { name: "play_family_messages", token: session.elder, args: {} },
  { name: "get_parent_status", token: session.caregiver, args: {} },
  { name: "send_message_to_parent", token: session.caregiver, args: { text: "Latency check, please ignore." } },
  { name: "update_medication_schedule", token: session.caregiver, args: { action: "change", medication: "metformin", times: ["08:00", "20:00"] } },
];

let id = 1;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
let failed = false;
console.log(`Target ${base}/mcp, ${iterations} calls per tool, budget p95 < ${BUDGET_MS} ms\n`);
console.log("tool".padEnd(28), "p50".padStart(7), "p95".padStart(7), "max".padStart(7));
for (const c of cases) {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const r = await post("/mcp", { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: c.name, arguments: c.args } }, c.token);
    times.push(performance.now() - t0);
    if (r.error) throw new Error(`${c.name}: ${JSON.stringify(r.error)}`);
  }
  const p95 = pct(times, 95);
  if (p95 >= BUDGET_MS) failed = true;
  console.log(c.name.padEnd(28), `${pct(times, 50).toFixed(0)}ms`.padStart(7), `${p95.toFixed(0)}ms`.padStart(7), `${Math.max(...times).toFixed(0)}ms`.padStart(7), p95 < BUDGET_MS ? "✓" : "✗ over budget");
}
await post("/api/demo/reset", {});
console.log(failed ? "\nFAIL: at least one tool is over budget." : "\nPASS: every tool is under the 500 ms budget.");
process.exit(failed ? 1 : 0);
