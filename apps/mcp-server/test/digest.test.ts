import { describe, expect, it } from "vitest";
import { checkDigest, templateDigest, writeDigestWithBedrock, type DigestFacts } from "../src/services/digest.js";

const facts = (over: Partial<DigestFacts> = {}): DigestFacts => ({
  elderName: "Kamala",
  date: "2026-10-22",
  localTime: "8:20 AM",
  doses: { taken: ["Amlodipine 5 mg at 8 AM"], missed: [], dueNowNotYetTaken: ["Metformin 500 mg at 8 AM"], upcoming: [] },
  medicineNames: ["Amlodipine", "Metformin", "Atorvastatin"],
  checkIn: null,
  moodTrendLastWeek: "steady",
  symptomsToday: [],
  alertsToday: [],
  messagesUnheard: 0,
  ...over,
});

describe("checkDigest", () => {
  it("rejects a 'missed' claim when nothing was missed (the bug Nova produced in production)", () => {
    expect(checkDigest("Kamala took Amlodipine at 8 AM but missed Metformin at the same time.", facts())).toMatch(/missed/);
    expect(checkDigest("Kamala took Amlodipine at 8 AM; Metformin is due now.", facts())).toBeNull();
    expect(checkDigest("Kamala missed Metformin at 8 AM.", facts({ doses: { taken: [], missed: ["Metformin 500 mg at 8 AM"], dueNowNotYetTaken: [], upcoming: [] } }))).toBeNull();
  });

  it("rejects medicines that aren't on the schedule, advice, and summaries that drop a red flag", () => {
    expect(checkDigest("Kamala took her aspirin.", facts())).toMatch(/aspirin/);
    expect(checkDigest("You should consult a doctor about the dizziness.", facts())).toMatch(/advice/);
    const redFlag = facts({ alertsToday: [{ kind: "red_flag", reason: "Kamala reported fainting", acknowledged: false }] });
    expect(checkDigest("Kamala took Amlodipine at 8 AM.", redFlag)).toMatch(/red-flag/);
    expect(checkDigest("Kamala reported fainting and the family was alerted.", redFlag)).toBeNull();
    expect(checkDigest("  ", facts())).toBe("empty");
  });
});

describe("writeDigestWithBedrock", () => {
  it("skips a model whose output fails the check and falls through to the next, then the template", async () => {
    const replies = ["Kamala missed Metformin.", "Kamala took Amlodipine at 8 AM. Metformin is due now."];
    const calls: string[] = [];
    const client = {
      send: async (cmd: any) => {
        calls.push(cmd.input.modelId);
        return { output: { message: { content: [{ text: replies.shift() }] } }, usage: { inputTokens: 10, outputTokens: 5 } };
      },
    } as any;
    const r = await writeDigestWithBedrock(facts(), client, ["claude", "nova"]);
    expect(calls).toEqual(["claude", "nova"]);
    expect(r.modelId).toBe("nova");

    const bad = { send: async () => ({ output: { message: { content: [{ text: "Kamala missed everything." }] } } }) } as any;
    const t = await writeDigestWithBedrock(facts(), bad, ["claude"]);
    expect(t.modelId).toBe("template");
    expect(t.text).toBe(templateDigest(facts()));
    expect(checkDigest(t.text, facts())).toBeNull();
  });
});
