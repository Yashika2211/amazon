import { beforeEach, describe, expect, it } from "vitest";
import { DEMO } from "../src/store/seed.js";
import { callTool, harness, rpc, tokenFor, type Harness } from "./helpers.js";

let h: Harness;
let elder: string;
let son: string;

beforeEach(async () => {
  h = await harness();
  elder = await tokenFor(h.deps, DEMO.elderId, "elder");
  son = await tokenFor(h.deps, DEMO.caregiverId, "caregiver");
});

const spoken = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;

describe("MCP protocol", () => {
  it("negotiates the exact initialize Alexa+ sends", async () => {
    const res = await rpc(h.app, elder, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: { roots: { listChanged: true } },
      clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["mcp-session-id"]).toBeUndefined();
    expect(res.body.result.protocolVersion).toBe("2025-03-26");
    expect(res.body.result.serverInfo.name).toBe("kinloop");
    expect(res.body.result.capabilities.tools).toBeDefined();
  });

  it("offers the 2025-11-25 spec to clients that ask for it", async () => {
    const res = await rpc(h.app, elder, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "inspector", version: "1" },
    });
    expect(res.body.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists all nine tools with descriptions, schemas and correct annotations", async () => {
    const res = await rpc(h.app, elder, "tools/list");
    const tools = res.body.result.tools as Array<{ name: string; description: string; inputSchema: any; annotations: any }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "daily_check_in",
      "get_parent_status",
      "get_today_plan",
      "log_medication",
      "play_family_messages",
      "report_symptom",
      "request_callback",
      "send_message_to_parent",
      "update_medication_schedule",
    ]);
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.get_today_plan!.annotations.readOnlyHint).toBe(true);
    expect(by.get_parent_status!.annotations.readOnlyHint).toBe(true);
    expect(by.log_medication!.annotations.idempotentHint).toBe(true);
    expect(by.update_medication_schedule!.annotations.destructiveHint).toBe(true);
    expect(by.report_symptom!.annotations.readOnlyHint).toBe(false);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(60);
      for (const prop of Object.values(t.inputSchema.properties ?? {}) as any[]) expect(prop.description).toBeTruthy();
    }
    expect(by.daily_check_in!.inputSchema.required).toEqual(["mood"]);
  });

  it("serves the Echo Show UI resources", async () => {
    const list = await rpc(h.app, elder, "resources/list");
    expect(list.body.result.resources.map((r: any) => r.uri)).toContain("ui://kinloop/today-plan");
    const read = await rpc(h.app, elder, "resources/read", { uri: "ui://kinloop/today-plan" });
    expect(read.body.result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(read.body.result.contents[0].text).toContain("ui/initialize");
  });

  it("never leaks stack traces on unexpected errors", async () => {
    const { default: request } = await import("supertest");
    h.deps.store.getCredential = async () => {
      throw new Error("boom at /var/task/secret.js");
    };
    const { pkceChallenge, randomToken } = await import("../src/oauth/crypto.js");
    const res = await request(h.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        response_type: "code",
        client_id: "kinloop-dev-tools",
        redirect_uri: "http://localhost:6274/oauth/callback",
        code_challenge: pkceChallenge(randomToken()),
        code_challenge_method: "S256",
        username: "kamala",
        pin: "1111",
      });
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.text).not.toMatch(/boom|var\/task|at /);
  });

  it("rejects GET and DELETE on the stateless endpoint", async () => {
    const { default: request } = await import("supertest");
    expect((await request(h.app).get("/mcp")).status).toBe(405);
    expect((await request(h.app).delete("/mcp")).status).toBe(405);
  });
});

describe("elder tools", () => {
  it("get_today_plan speaks the plan and returns matching structured content", async () => {
    const r = await callTool(h.app, elder, "get_today_plan");
    expect(spoken(r)).toContain("Good morning, Kamala.");
    expect(spoken(r)).toContain("Amlodipine 5 mg and Metformin 500 mg at 8 AM");
    expect(spoken(r)).toContain("You have an eye check-up with Dr. Mehta at 4:30 PM");
    expect(spoken(r)).toContain("Arjun left you 1 message");
    expect(spoken(r)).not.toMatch(/[*#`]/);
    expect(r.structuredContent.medications).toHaveLength(4);
    expect(r.structuredContent.speech).toBe(spoken(r));
    expect(r._meta?.ui?.resourceUri).toBe("ui://kinloop/today-plan");
  });

  it("log_medication matches by purpose and is idempotent on retry", async () => {
    const first = await callTool(h.app, elder, "log_medication", { medication: "my blood pressure pill" });
    expect(spoken(first)).toContain("Amlodipine 5 mg for 8 AM is marked as taken");
    const again = await callTool(h.app, elder, "log_medication", { medication: "my blood pressure pill" });
    expect(spoken(again)).toContain("already logged");
    const logs = await h.deps.store.listDoseLogs(DEMO.householdId, "2026-10-21", "2026-10-21");
    expect(logs).toHaveLength(1);
  });

  it("log_medication asks which one when ambiguous, and logs all due doses on request", async () => {
    const amb = await callTool(h.app, elder, "log_medication", {});
    expect(spoken(amb)).toMatch(/Which one did you take: Amlodipine or Metformin/);
    const all = await callTool(h.app, elder, "log_medication", { allDue: true });
    expect(spoken(all)).toContain("Amlodipine 5 mg and Metformin 500 mg");
    expect(await h.deps.store.listDoseLogs(DEMO.householdId, "2026-10-21", "2026-10-21")).toHaveLength(2);
  });

  it("log_medication handles unknown medicines without an error", async () => {
    const r = await callTool(h.app, elder, "log_medication", { medication: "aspirin" });
    expect(r.isError).toBeFalsy();
    expect(spoken(r)).toContain("couldn't find aspirin");
  });

  it("daily_check_in records mood and sleep", async () => {
    const r = await callTool(h.app, elder, "daily_check_in", { mood: 3, sleep: "poor", note: "slept badly" });
    expect(spoken(r)).toBe("Thank you, Kamala. I've noted that you're feeling okay and that you slept badly. I'll let your family know in today's update.");
    expect((await h.deps.store.listCheckIns(DEMO.householdId, "2026-10-21"))[0]!.mood).toBe(3);
  });

  it("invalid input comes back as a short spoken sentence, not a stack trace", async () => {
    const r = await callTool(h.app, elder, "daily_check_in", { mood: 9 });
    expect(r.isError).toBe(true);
    expect(spoken(r)).toBe("How are you feeling today, on a scale of one to five, where one is very low and five is great?");
    const r2 = await callTool(h.app, son, "update_medication_schedule", { action: "explode", medication: "x" });
    expect(r2.isError).toBe(true);
    expect(spoken(r2)).not.toMatch(/zod|invalid_enum|Error:/i);
  });

  it("report_symptom: a red flag alerts the family immediately and tells Kamala to call 112", async () => {
    const r = await callTool(h.app, elder, "report_symptom", { description: "I'm feeling dizzy and I nearly fainted" });
    expect(r.structuredContent.redFlag).toBe(true);
    expect(spoken(r)).toContain("Please call 112 now");
    expect(spoken(r)).toContain("I've alerted Arjun");
    expect(spoken(r)).toContain("I can't call emergency services for you");
    expect(h.notifier.sent).toHaveLength(1);
    expect(h.notifier.sent[0]!.alert).toMatchObject({ kind: "red_flag", severity: "urgent" });
    expect(h.notifier.sent[0]!.to).toEqual(["Arjun"]);

    // Same incident a few minutes later: no second alert.
    h.clock.advanceMinutes(5);
    const again = await callTool(h.app, elder, "report_symptom", { description: "still feel faint" });
    expect(again.structuredContent.newIncident).toBe(false);
    expect(h.notifier.sent).toHaveLength(1);
  });

  it("report_symptom: non-red-flag symptoms are logged without alerting", async () => {
    const r = await callTool(h.app, elder, "report_symptom", { description: "I'm feeling a bit dizzy" });
    expect(r.structuredContent.redFlag).toBe(false);
    expect(h.notifier.sent).toHaveLength(0);
    expect(await h.deps.store.listSymptoms(DEMO.householdId, "2026-10-21")).toHaveLength(1);
  });

  it("request_callback notifies the right person and dedupes repeats", async () => {
    const r = await callTool(h.app, elder, "request_callback", { who: "my son" });
    expect(spoken(r)).toBe("Okay. I've let Arjun know you'd like a call.");
    const again = await callTool(h.app, elder, "request_callback", { who: "my son" });
    expect(again.structuredContent.duplicate).toBe(true);
    expect(h.notifier.sent).toHaveLength(1);
  });

  it("play_family_messages reads unheard messages and marks them heard", async () => {
    const r = await callTool(h.app, elder, "play_family_messages", { from: "my son" });
    expect(spoken(r)).toContain("From Arjun");
    expect(spoken(r)).toContain("I'll call you tonight after dinner");
    const again = await callTool(h.app, elder, "play_family_messages", {});
    expect(spoken(again)).toContain("There are no new messages");
  });

  it("elder-only tools refuse caregiver tokens with a spoken explanation", async () => {
    const r = await callTool(h.app, son, "log_medication", { medication: "metformin" });
    expect(r.isError).toBe(true);
    expect(spoken(r)).toContain("Only Kamala can log that");
  });
});

describe("family tools", () => {
  it("get_parent_status reflects what Kamala just did, including the red flag", async () => {
    await callTool(h.app, elder, "log_medication", { allDue: true });
    await callTool(h.app, elder, "report_symptom", { description: "I fell in the bathroom" });
    await h.deps.digest.idle();
    const r = await callTool(h.app, son, "get_parent_status");
    expect(spoken(r)).toMatch(/^Urgent: Kamala reported a fall/);
    expect(r.structuredContent.doses.taken).toHaveLength(2);
    expect(r.structuredContent.alertsToday[0].kind).toBe("red_flag");
    expect(r.structuredContent.adherence7d).toHaveLength(7);
    expect(r._meta?.ui?.resourceUri).toBe("ui://kinloop/parent-status");
  });

  it("get_parent_status speaks a live summary when the stored digest is stale", async () => {
    await callTool(h.app, elder, "daily_check_in", { mood: 4 });
    // No digest.idle(): the async digest hasn't landed yet.
    const r = await callTool(h.app, son, "get_parent_status");
    expect(r.structuredContent.digest.source).toMatch(/template/);
    expect(spoken(r)).toContain("mood of 4 out of 5");
  });

  it("send_message_to_parent queues a message Kamala hears next", async () => {
    const r = await callTool(h.app, son, "send_message_to_parent", { text: "I'll visit on Sunday" });
    expect(spoken(r)).toContain("I'll visit on Sunday");
    const plan = await callTool(h.app, elder, "play_family_messages", {});
    expect(spoken(plan)).toContain("I'll visit on Sunday");
  });

  it("update_medication_schedule needs explicit confirmation before changing anything", async () => {
    const args = { action: "add", medication: "Glimepiride", dose: "1 mg", times: ["20:00"] };
    const preview = await callTool(h.app, son, "update_medication_schedule", args);
    expect(preview.structuredContent.needsConfirmation).toBe(true);
    expect(spoken(preview)).toBe("Just to confirm: add Glimepiride 1 mg at 8 PM for Kamala. Should I go ahead?");
    expect(await h.deps.store.listMedications(DEMO.householdId)).toHaveLength(3);

    const done = await callTool(h.app, son, "update_medication_schedule", { ...args, confirm: true });
    expect(done.structuredContent.applied).toBe(true);
    expect(await h.deps.store.listMedications(DEMO.householdId)).toHaveLength(4);

    const remove = await callTool(h.app, son, "update_medication_schedule", { action: "remove", medication: "glimepiride", confirm: true });
    expect(spoken(remove)).toContain("removed Glimepiride");
    const dup = await callTool(h.app, son, "update_medication_schedule", { action: "add", medication: "Metformin", dose: "500 mg", times: ["20:00"] });
    expect(dup.isError).toBe(true);
    expect(spoken(dup)).toContain("already on Kamala's schedule");
  });

  it("caregiver-only tools refuse the elder", async () => {
    const r = await callTool(h.app, elder, "update_medication_schedule", { action: "remove", medication: "metformin", confirm: true });
    expect(r.isError).toBe(true);
    expect((await h.deps.store.listMedications(DEMO.householdId)).every((m) => m.active)).toBe(true);
  });
});

describe("household isolation", () => {
  it("a token for another household can never read or write the demo household", async () => {
    await h.deps.store.putHousehold({
      id: "hh-other",
      name: "Other",
      timezone: "America/Chicago",
      elderMemberId: "m-other-elder",
      checkInDeadline: "10:00",
      emergencyNumber: "911",
      createdAt: new Date().toISOString(),
    });
    await h.deps.store.putMember({ id: "m-other-elder", householdId: "hh-other", role: "elder", name: "Walter" });
    await h.deps.store.putMember({ id: "m-other-care", householdId: "hh-other", role: "caregiver", name: "June" });
    const otherCare = await tokenFor(h.deps, "m-other-care", "caregiver", "hh-other");
    const otherElder = await tokenFor(h.deps, "m-other-elder", "elder", "hh-other");

    const status = await callTool(h.app, otherCare, "get_parent_status");
    expect(status.structuredContent.elderName).toBe("Walter");
    expect(JSON.stringify(status)).not.toMatch(/Kamala|Amlodipine|Arjun/);

    await callTool(h.app, otherElder, "log_medication", { allDue: true });
    await callTool(h.app, otherCare, "send_message_to_parent", { text: "hello" });
    expect(await h.deps.store.listDoseLogs(DEMO.householdId, "2026-10-21", "2026-10-21")).toHaveLength(0);
    expect((await h.deps.store.listMessages(DEMO.householdId)).some((m) => m.text === "hello")).toBe(false);

    // A token whose member doesn't belong to the household it names gets nothing.
    const forged = await tokenFor(h.deps, DEMO.caregiverId, "caregiver", "hh-other");
    const r = await callTool(h.app, forged, "get_parent_status");
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Kamala/);
  });
});
