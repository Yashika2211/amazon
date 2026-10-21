import { describe, expect, it } from "vitest";
import { callbackAlert, classifySymptom, redFlagAlert } from "../src/rules/redFlags.js";
import type { Alert, Symptom } from "../src/types.js";

describe("classifySymptom", () => {
  it.each([
    ["My chest feels tight and there is pain in my chest", ["chest_pain"]],
    ["I can't breathe properly", ["breathlessness"]],
    ["I'm short of breath", ["breathlessness"]],
    ["I fell in the bathroom", ["fall"]],
    ["I slipped on the stairs", ["fall"]],
    ["I'm dizzy and I nearly fainted", ["fainting"]],
    ["I passed out for a minute", ["fainting"]],
    ["I feel confused, I don't know where I am", ["confusion"]],
    ["my face is drooping and my speech is slurred", ["stroke_signs"]],
    ["I can't lift my arm", ["stroke_signs"]],
    ["I'm feeling dizzy", []],
    ["slight headache", []],
    ["I fell asleep early", []],
    ["no chest pain, just tired", []],
    ["I did not faint", []],
    ["Chest pain and I can’t breathe", ["chest_pain", "breathlessness"]],
  ])("%s → %j", (text, flags) => {
    expect(classifySymptom(text)).toEqual(flags);
  });
});

const symptom = (flags: Symptom["flags"], at = "2026-10-21T04:00:00.000Z"): Symptom => ({
  id: "s1",
  householdId: "hh1",
  at,
  date: "2026-10-21",
  text: "I fell and my chest hurts",
  flags,
});

describe("redFlagAlert", () => {
  it("returns null for non-red-flag symptoms", () => {
    expect(redFlagAlert(symptom([]), "Kamala", [])).toBeNull();
  });

  it("builds an urgent alert with the reason and details", () => {
    const a = redFlagAlert(symptom(["fall", "chest_pain"]), "Kamala", [])!;
    expect(a).toMatchObject({
      kind: "red_flag",
      severity: "urgent",
      incidentKey: "red_flag:s1",
      details: { flags: "chest_pain+fall" },
    });
    expect(a.reason).toContain("Kamala reported a fall and chest pain");
  });

  it("deduplicates the same flags within 30 minutes, but not later or different flags", () => {
    const first = redFlagAlert(symptom(["fall"]), "Kamala", [])!;
    expect(redFlagAlert(symptom(["fall"], "2026-10-21T04:20:00.000Z"), "Kamala", [first])).toBeNull();
    expect(redFlagAlert(symptom(["fall"], "2026-10-21T05:00:00.000Z"), "Kamala", [first])).not.toBeNull();
    expect(redFlagAlert(symptom(["chest_pain"], "2026-10-21T04:10:00.000Z"), "Kamala", [first])).not.toBeNull();
    const other: Alert = { ...first, kind: "missed_dose" };
    expect(redFlagAlert(symptom(["fall"]), "Kamala", [other])).not.toBeNull();
  });
});

describe("callbackAlert", () => {
  const at = "2026-10-21T04:00:00.000Z";
  it("creates a callback request with an optional note", () => {
    const a = callbackAlert("hh1", "Kamala", "Arjun", at, [], "about Sunday")!;
    expect(a.reason).toBe('Kamala asked Arjun to call. Note: "about Sunday"');
    expect(callbackAlert("hh1", "Kamala", "Arjun", at, [])!.reason).toBe("Kamala asked Arjun to call.");
  });

  it("deduplicates repeats within 15 minutes for the same person", () => {
    const a = callbackAlert("hh1", "Kamala", "Arjun", at, [])!;
    expect(callbackAlert("hh1", "Kamala", "Arjun", "2026-10-21T04:10:00.000Z", [a])).toBeNull();
    expect(callbackAlert("hh1", "Kamala", "Priya", "2026-10-21T04:10:00.000Z", [a])).not.toBeNull();
    expect(callbackAlert("hh1", "Kamala", "Arjun", "2026-10-21T04:30:00.000Z", [a])).not.toBeNull();
    expect(callbackAlert("hh1", "Kamala", "Arjun", at, [{ ...a, kind: "red_flag" }])).not.toBeNull();
  });
});
