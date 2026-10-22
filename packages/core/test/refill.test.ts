import { describe, expect, it } from "vitest";
import { evaluateRefills, refillStatus } from "../src/rules/refill.js";
import { runEscalation } from "../src/rules/engine.js";
import { household, ist, med } from "./fixtures.js";

describe("refill countdown", () => {
  it("computes days left from tablets and doses per day", () => {
    expect(refillStatus(med("m", "Metformin", ["08:00", "20:00"], { pillsLeft: 9 }))).toMatchObject({ dosesPerDay: 2, daysLeft: 4, needsRefill: true });
    expect(refillStatus(med("m", "Amlodipine", ["08:00"], { pillsLeft: 24 }))).toMatchObject({ daysLeft: 24, needsRefill: false });
    expect(refillStatus(med("m", "X", ["08:00"], { pillsLeft: -3 }))).toMatchObject({ pillsLeft: 0, daysLeft: 0 });
  });

  it("ignores untracked, inactive or unscheduled medicines", () => {
    expect(refillStatus(med("m", "X", ["08:00"]))).toBeNull();
    expect(refillStatus(med("m", "X", ["08:00"], { pillsLeft: 2, active: false }))).toBeNull();
    expect(refillStatus(med("m", "X", [], { pillsLeft: 2 }))).toBeNull();
  });

  it("raises one alert per supply, more urgent when it has run out", () => {
    const low = med("m", "Metformin", ["08:00", "20:00"], { pillsLeft: 9, refilledAt: "2026-10-01T00:00:00.000Z" });
    const [a] = evaluateRefills([low], "Kamala");
    expect(a).toMatchObject({ kind: "refill_due", severity: "info", incidentKey: "refill:m:2026-10-01T00:00:00.000Z" });
    expect(a!.reason).toBe("Kamala's Metformin 5mg runs out in about 4 days. Time to order a refill.");
    const out = evaluateRefills([med("n", "Amlodipine", ["08:00"], { pillsLeft: 1 })], "Kamala")[0]!;
    expect(out).toMatchObject({ severity: "warning", incidentKey: "refill:n:2026-10-01T00:00:00.000Z" });
    expect(out.reason).toContain("runs out in about 1 day.");
    expect(evaluateRefills([med("z", "Atorvastatin", ["21:00"], { pillsLeft: 0 })], "Kamala")[0]!.reason).toContain("has run out");
    expect(evaluateRefills([med("ok", "A", ["08:00"], { pillsLeft: 30 })], "Kamala")).toEqual([]);
  });

  it("is part of the scheduled escalation pass and deduplicates", () => {
    const input = {
      household,
      elderName: "Kamala",
      medications: [med("m", "Metformin", ["20:00"], { pillsLeft: 3 })],
      todaysDoseLogs: [],
      checkIns: [{ householdId: "hh1", date: "2026-10-21", at: "x", mood: 4 }],
      existingIncidentKeys: new Set<string>(),
      now: ist("09:00"),
    };
    const first = runEscalation(input);
    expect(first.alerts.map((a) => a.kind)).toEqual(["refill_due"]);
    expect(runEscalation({ ...input, existingIncidentKeys: new Set(first.alerts.map((a) => a.incidentKey)) }).alerts).toEqual([]);
  });
});
