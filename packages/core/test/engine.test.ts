import { describe, expect, it } from "vitest";
import { dedupe, runEscalation } from "../src/rules/engine.js";
import { evaluateCheckIn, evaluateLowMood, lowMoodStreak } from "../src/rules/wellbeing.js";
import { adherence, moodTrend, summarizeDay } from "../src/stats.js";
import { doseSlotsForDay } from "../src/rules/doses.js";
import { checkIn, household, ist, log, med } from "./fixtures.js";

const amlo = med("amlo", "Amlodipine", ["08:00"]);

describe("evaluateCheckIn", () => {
  it("alerts after the deadline when there is no check-in", () => {
    expect(evaluateCheckIn(undefined, "2026-10-21", 10 * 60, "11:00", "Kamala")).toBeNull();
    const a = evaluateCheckIn(undefined, "2026-10-21", 11 * 60, "11:00", "Kamala", "2026-10-20")!;
    expect(a).toMatchObject({ incidentKey: "no_checkin:2026-10-21", details: { lastCheckIn: "2026-10-20" } });
    expect(a.reason).toContain("11 AM");
    expect(evaluateCheckIn(undefined, "2026-10-21", 12 * 60, "11:00", "Kamala")!.details.lastCheckIn).toBe("none");
    expect(evaluateCheckIn(checkIn("2026-10-21", 4), "2026-10-21", 12 * 60, "11:00", "Kamala")).toBeNull();
  });
});

describe("low mood", () => {
  it("counts a streak ending today", () => {
    const cs = [checkIn("2026-10-18", 4), checkIn("2026-10-19", 2), checkIn("2026-10-20", 1), checkIn("2026-10-21", 2)];
    expect(lowMoodStreak(cs, "2026-10-21")).toEqual({ days: 3, start: "2026-10-19", moods: [2, 1, 2] });
    expect(evaluateLowMood(cs, "2026-10-21", "Kamala")).toMatchObject({
      incidentKey: "low_mood:2026-10-19",
      details: { days: 3, moods: "2, 1, 2" },
    });
  });

  it("counts a streak ending yesterday when today has no check-in yet", () => {
    const cs = [checkIn("2026-10-18", 2), checkIn("2026-10-19", 2), checkIn("2026-10-20", 1)];
    expect(lowMoodStreak(cs, "2026-10-21").days).toBe(3);
  });

  it("does not nudge for short streaks", () => {
    const cs = [checkIn("2026-10-20", 1), checkIn("2026-10-21", 2)];
    expect(evaluateLowMood(cs, "2026-10-21", "Kamala")).toBeNull();
  });
});

describe("runEscalation", () => {
  it("combines dose, check-in and mood rules and dedupes by incident", () => {
    const input = {
      household,
      elderName: "Kamala",
      medications: [amlo],
      todaysDoseLogs: [],
      checkIns: [checkIn("2026-10-18", 1), checkIn("2026-10-19", 2), checkIn("2026-10-20", 2)],
      existingIncidentKeys: new Set<string>(),
      now: ist("11:30"),
    };
    const first = runEscalation(input);
    expect(first.alerts.map((a) => a.kind).sort()).toEqual(["low_mood", "missed_dose", "no_checkin"]);
    expect(first.alerts.every((a) => a.householdId === "hh1" && a.createdAt === input.now.toISOString())).toBe(true);
    expect(first.reminders).toHaveLength(1);

    const keys = new Set([...first.alerts, ...first.reminders].map((x) => x.incidentKey));
    const second = runEscalation({ ...input, existingIncidentKeys: keys });
    expect(second).toEqual({ alerts: [], reminders: [] });
  });

  it("is quiet on a good day", () => {
    const r = runEscalation({
      household,
      elderName: "Kamala",
      medications: [amlo],
      todaysDoseLogs: [log("amlo", "08:00")],
      checkIns: [checkIn("2026-10-21", 4)],
      existingIncidentKeys: new Set(),
      now: ist("12:00"),
    });
    expect(r).toEqual({ alerts: [], reminders: [] });
  });

  it("dedupe drops duplicates within a batch", () => {
    expect(dedupe([{ incidentKey: "a" }, { incidentKey: "a" }, { incidentKey: "b" }], new Set(["b"]))).toEqual([
      { incidentKey: "a" },
    ]);
  });
});

describe("stats", () => {
  const metf = med("metf", "Metformin", ["08:00", "20:00"]);

  it("summarizes a day", () => {
    const s = summarizeDay(doseSlotsForDay([amlo, metf], [log("amlo", "08:00")], 10 * 60));
    expect(s.taken).toHaveLength(1);
    expect(s.missed).toHaveLength(1);
    expect(s.upcoming).toHaveLength(1);
    expect(summarizeDay(doseSlotsForDay([amlo], [], 8 * 60 + 5)).pending).toHaveLength(1);
  });

  it("computes 7-day adherence, counting only due doses today", () => {
    const logs = [log("metf", "08:00", "2026-10-20"), log("metf", "20:00", "2026-10-20"), log("metf", "08:00")];
    const a = adherence([metf], logs, "2026-10-21", 9 * 60, 3);
    expect(a).toEqual([
      { date: "2026-10-19", taken: 0, scheduled: 2 },
      { date: "2026-10-20", taken: 2, scheduled: 2 },
      { date: "2026-10-21", taken: 1, scheduled: 1 },
    ]);
    expect(adherence([metf], [], "2026-10-21", 600)).toHaveLength(7);
  });

  it("computes the mood trend", () => {
    const series = (moods: number[]) => moods.map((m, i) => checkIn(`2026-10-${String(10 + i)}`, m));
    expect(moodTrend(series([3, 3, 3]))).toBe("unknown");
    expect(moodTrend(series([2, 2, 2, 4, 4, 4]))).toBe("improving");
    expect(moodTrend(series([4, 4, 4, 2, 2, 2]))).toBe("declining");
    expect(moodTrend(series([3, 3, 3, 3]))).toBe("steady");
  });
});
