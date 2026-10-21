import { describe, expect, it } from "vitest";
import { doseSlotsForDay, evaluateDoses, matchDose, medicationMatches } from "../src/rules/doses.js";
import { log, med } from "./fixtures.js";

const amlo = med("amlo", "Amlodipine", ["08:00"], { purpose: "blood pressure" });
const metf = med("metf", "Metformin", ["08:00", "20:00"], { dose: "500mg", purpose: "diabetes" });
const ator = med("ator", "Atorvastatin", ["21:00"], { dose: "10mg" });
const meds = [amlo, metf, ator];

describe("doseSlotsForDay", () => {
  it("assigns statuses relative to now", () => {
    const at = (m: number) => doseSlotsForDay(meds, [log("amlo", "08:00")], m);
    const slots = at(9 * 60 + 30);
    expect(slots.map((s) => [s.medicationId, s.slot, s.status])).toEqual([
      ["amlo", "08:00", "taken"],
      ["metf", "08:00", "late"],
      ["metf", "20:00", "upcoming"],
      ["ator", "21:00", "upcoming"],
    ]);
    expect(slots[0]!.takenAt).toBeDefined();
    expect(slots[0]!.purpose).toBe("blood pressure");
    expect(slots[3]!.purpose).toBeUndefined();
    expect(at(8 * 60 + 10).find((s) => s.medicationId === "metf")!.status).toBe("due");
    expect(at(10 * 60).find((s) => s.medicationId === "metf")!.status).toBe("missed");
  });

  it("skips inactive medications", () => {
    expect(doseSlotsForDay([{ ...amlo, active: false }], [], 600)).toEqual([]);
  });
});

describe("medicationMatches", () => {
  it("matches by name, prefix, purpose and synonyms", () => {
    expect(medicationMatches(metf, "metformin")).toBe(true);
    expect(medicationMatches(metf, "metforman")).toBe(true);
    expect(medicationMatches(amlo, "my blood pressure pill")).toBe(true);
    expect(medicationMatches(amlo, "BP tablet")).toBe(true);
    expect(medicationMatches(metf, "sugar medicine")).toBe(true);
    expect(medicationMatches(ator, "sugar medicine")).toBe(false);
    expect(medicationMatches(amlo, "my pill")).toBe(false);
    // Short words must not substring-match names ("in" is inside "Metformin").
    expect(medicationMatches(metf, "in it")).toBe(false);
  });
});

describe("matchDose", () => {
  it("matches a named dose to the nearest untaken slot", () => {
    const r = matchDose(meds, [], 8 * 60 + 15, "blood pressure pill");
    expect(r).toMatchObject({ kind: "match", slot: "08:00", minutesFromSchedule: 15 });
    if (r.kind === "match") expect(r.medication.id).toBe("amlo");
  });

  it("picks the evening slot in the evening", () => {
    const r = matchDose(meds, [log("metf", "08:00")], 20 * 60 + 5, "metformin");
    expect(r).toMatchObject({ kind: "match", slot: "20:00" });
  });

  it("is idempotent: a second log of the same dose reports already_logged", () => {
    const r = matchDose(meds, [log("amlo", "08:00")], 8 * 60 + 30, "blood pressure");
    expect(r).toMatchObject({ kind: "already_logged", slot: "08:00" });
  });

  it("reports the latest taken slot when several are taken", () => {
    const r = matchDose(meds, [log("metf", "08:00"), log("metf", "20:00")], 21 * 60, "metformin");
    expect(r).toMatchObject({ kind: "already_logged", slot: "20:00" });
  });

  it("asks which one when two medications are equally due", () => {
    const r = matchDose(meds, [], 8 * 60, "my pill");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.options.map((o) => o.medication.id).sort()).toEqual(["amlo", "metf"]);
  });

  it("matches without a name when only one dose is due", () => {
    const r = matchDose(meds, [log("amlo", "08:00"), log("metf", "08:00")], 21 * 60);
    expect(r).toMatchObject({ kind: "match", slot: "21:00" });
  });

  it("allows logging up to 60 minutes early", () => {
    expect(matchDose(meds, [], 7 * 60 + 5, "amlodipine")).toMatchObject({ kind: "match", minutesFromSchedule: -55 });
  });

  it("says not due when it is too early", () => {
    const r = matchDose(meds, [], 6 * 60, "atorvastatin");
    expect(r).toMatchObject({ kind: "not_due", nextSlot: "21:00" });
  });

  it("handles unknown and missing medications", () => {
    expect(matchDose(meds, [], 600, "aspirin")).toEqual({ kind: "unknown_medication" });
    expect(matchDose([], [], 600, "aspirin")).toEqual({ kind: "no_medications" });
    expect(matchDose([{ ...amlo, times: [] }], [], 600)).toEqual({ kind: "no_medications" });
  });
});

describe("evaluateDoses", () => {
  it("queues a reminder at +60 and a family alert at +120", () => {
    const at60 = evaluateDoses([amlo], [], "2026-10-21", 9 * 60, "Kamala");
    expect(at60.reminders).toHaveLength(1);
    expect(at60.reminders[0]!.incidentKey).toBe("reminder:2026-10-21:amlo:08:00");
    expect(at60.reminders[0]!.text).toContain("8 AM");
    expect(at60.alerts).toHaveLength(0);

    const at120 = evaluateDoses([amlo, ator], [], "2026-10-21", 10 * 60, "Kamala");
    expect(at120.alerts).toHaveLength(1);
    expect(at120.alerts[0]).toMatchObject({
      incidentKey: "missed_dose:2026-10-21:amlo:08:00",
      kind: "missed_dose",
      details: { minutesLate: 120, dosesTakenToday: 0, dosesDueSoFar: 1 },
    });
    expect(at120.alerts[0]!.reason).toContain("120 minutes");
  });

  it("does nothing for taken, upcoming or just-due doses", () => {
    const r = evaluateDoses([amlo, metf], [log("amlo", "08:00")], "2026-10-21", 8 * 60 + 30, "Kamala");
    expect(r).toEqual({ reminders: [], alerts: [] });
  });
});
