import { describe, expect, it } from "vitest";
import {
  addDays,
  formatHHMM,
  isHHMM,
  lastNDates,
  localParts,
  parseHHMM,
  weekdayName,
} from "../src/time.js";
import { plural, speakable, spokenList, spokenTime } from "../src/spoken.js";

describe("time", () => {
  it("converts an instant to local parts in the household zone", () => {
    const p = localParts(new Date("2026-10-21T02:30:00Z"), "Asia/Kolkata");
    expect(p).toEqual({ date: "2026-10-21", minutes: 8 * 60, hhmm: "08:00" });
    // cached formatter path
    expect(localParts(new Date("2026-10-21T20:00:00Z"), "Asia/Kolkata").date).toBe("2026-10-22");
  });

  it("handles midnight as 00:00", () => {
    expect(localParts(new Date("2026-10-21T18:30:00Z"), "Asia/Kolkata").hhmm).toBe("00:00");
  });

  it("parses and validates HH:MM", () => {
    expect(parseHHMM("20:30")).toBe(1230);
    expect(() => parseHHMM("8pm")).toThrow(/Invalid time/);
    expect(isHHMM("07:05")).toBe(true);
    expect(isHHMM("24:00")).toBe(false);
    expect(formatHHMM(65)).toBe("01:05");
  });

  it("does date arithmetic", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(lastNDates("2026-10-21", 3)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(weekdayName("2026-10-25")).toBe("Sunday");
  });
});

describe("spoken", () => {
  it("speaks times naturally", () => {
    expect(spokenTime("08:00")).toBe("8 AM");
    expect(spokenTime("20:30")).toBe("8:30 PM");
    expect(spokenTime("00:00")).toBe("12 AM");
    expect(spokenTime("12:05")).toBe("12:05 PM");
  });

  it("joins lists", () => {
    expect(spokenList([])).toBe("");
    expect(spokenList(["a"])).toBe("a");
    expect(spokenList(["a", "b"])).toBe("a and b");
    expect(spokenList(["a", "b", "c"])).toBe("a, b, and c");
  });

  it("pluralizes and strips markdown", () => {
    expect(plural(1, "dose")).toBe("1 dose");
    expect(plural(2, "dose")).toBe("2 doses");
    expect(plural(2, "person", "people")).toBe("2 people");
    expect(speakable("**Hello**   _world_ #1")).toBe("Hello world 1");
  });
});
