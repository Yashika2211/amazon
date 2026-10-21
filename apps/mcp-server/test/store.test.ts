import { describe, expect, it } from "vitest";
import { Store } from "../src/store/store.js";
import { MemoryTable } from "../src/store/table.js";
import { DEMO, seedDemo, wipeDemo } from "../src/store/seed.js";

const now = new Date("2026-10-21T02:50:00Z"); // 08:20 IST

describe("DynamoTable", () => {
  it("queries a whole partition without begins_with when the prefix is empty", async () => {
    const { DynamoTable } = await import("../src/store/table.js");
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const sent: any[] = [];
    const fake = { send: async (cmd: any) => (sent.push(cmd.input), { Items: [] }) };
    const t = new DynamoTable("t", new DynamoDBClient({ region: "ap-southeast-2" }));
    (t as any).doc = fake;
    await t.query("HH#x", "");
    await t.query("HH#x", "MED#");
    expect(sent[0].KeyConditionExpression).toBe("pk = :pk");
    expect(sent[0].ExpressionAttributeValues).toEqual({ ":pk": "HH#x" });
    expect(sent[1].KeyConditionExpression).toBe("pk = :pk AND begins_with(sk, :sk)");
  });
});

describe("Store", () => {
  it("seeds a demo household with a week of history", async () => {
    const table = new MemoryTable();
    const store = new Store(table);
    await seedDemo(store, { now });
    expect((await store.getHousehold(DEMO.householdId))!.timezone).toBe("Asia/Kolkata");
    expect(await store.listMedications(DEMO.householdId)).toHaveLength(3);
    expect(await store.listCheckIns(DEMO.householdId, "2026-10-14")).toHaveLength(7);
    const logs = await store.listDoseLogs(DEMO.householdId, "2026-10-14", "2026-10-20");
    expect(logs.length).toBe(7 * 4 - 3);
    expect(await store.listDoseLogs(DEMO.householdId, "2026-10-21", "2026-10-21")).toHaveLength(0);
    expect(await store.listHouseholdIds()).toEqual([DEMO.householdId]);

    await wipeDemo(table);
    expect(await store.getHousehold(DEMO.householdId)).toBeUndefined();
  });

  it("dose logs and alerts are idempotent per key", async () => {
    const store = new Store(new MemoryTable());
    const log = { householdId: "h", date: "2026-10-21", medicationId: "m", slot: "08:00", takenAt: now.toISOString(), loggedBy: "e" };
    expect(await store.putDoseLogIfAbsent(log)).toBe(true);
    expect(await store.putDoseLogIfAbsent({ ...log, takenAt: "later" })).toBe(false);
    expect((await store.listDoseLogs("h", "2026-10-21", "2026-10-21"))[0]!.takenAt).toBe(now.toISOString());

    const alert = { householdId: "h", incidentKey: "k", kind: "no_checkin" as const, severity: "warning" as const, reason: "r", details: {}, createdAt: now.toISOString() };
    expect(await store.putAlertIfAbsent(alert)).toBe(true);
    expect(await store.putAlertIfAbsent(alert)).toBe(false);
    expect(await store.acknowledgeAlert("h", "k", now.toISOString())).toBe(true);
    expect(await store.acknowledgeAlert("h", "missing", now.toISOString())).toBe(false);
    expect([...(await store.incidentKeys("h"))]).toEqual(["k"]);
  });

  it("auth codes and refresh tokens can be redeemed only once, and expire", async () => {
    const store = new Store(new MemoryTable());
    const rec = { clientId: "c", redirectUri: "https://x", codeChallenge: "x", scope: "kinloop", householdId: "h", memberId: "m", role: "elder" as const, expiresAt: Date.now() + 60000 };
    await store.putAuthCode("hash", rec);
    expect(await store.consumeAuthCode("hash")).toMatchObject({ clientId: "c" });
    expect(await store.consumeAuthCode("hash")).toBeUndefined();

    await store.putAccessToken("old", { ...rec, expiresAt: Date.now() - 1 });
    expect(await store.getAccessToken("old")).toBeUndefined();
    await store.putRefreshToken("rt", rec);
    expect(await store.consumeRefreshToken("rt")).toBeDefined();
    expect(await store.consumeRefreshToken("rt")).toBeUndefined();
  });

  it("messages can be marked heard", async () => {
    const store = new Store(new MemoryTable());
    const m = { id: "1", householdId: "h", kind: "family" as const, fromName: "A", text: "hi", createdAt: now.toISOString() };
    expect(await store.putMessage(m)).toBe(true);
    expect(await store.putMessage(m)).toBe(false);
    await store.markHeard("h", ["1", "nope"], now.toISOString());
    expect((await store.listMessages("h"))[0]!.heardAt).toBe(now.toISOString());
  });
});
