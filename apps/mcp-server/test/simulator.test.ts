import { describe, expect, it } from "vitest";
import { routeUtterance } from "../src/services/simulator.js";

describe("simulator keyword router (fallback when Bedrock is unavailable)", () => {
  it.each([
    ["Alexa, what do I need to do today?", "get_today_plan"],
    ["I just took my blood pressure pill", "log_medication"],
    ["maine BP ki goli le li", "log_medication"],
    ["मैंने बीपी की गोली ली", "log_medication"],
    ["I'm feeling dizzy and I nearly fainted", "report_symptom"],
    ["mujhe chakkar aa raha hai", "report_symptom"],
    ["मुझे सीने में दर्द हो रहा है", "report_symptom"],
    ["I took my pill and now my chest hurts", "report_symptom"],
    ["beta ko bolo phone kare", "request_callback"],
    ["Any messages from my son?", "play_family_messages"],
    ["I'm feeling okay, slept badly", "daily_check_in"],
    ["main theek hoon, neend nahi aayi", "daily_check_in"],
  ])("%s → %s", (text, tool) => {
    expect(routeUtterance("elder", text)?.tool).toBe(tool);
  });

  it("maps Hindi family words and moods", () => {
    expect(routeUtterance("elder", "beta ko bolo phone kare")?.arguments).toEqual({ who: "son" });
    expect(routeUtterance("elder", "aaj thoda udaas hoon")?.arguments).toMatchObject({ mood: 2 });
    expect(routeUtterance("elder", "main theek hoon, neend nahi aayi")?.arguments).toMatchObject({ sleep: "poor" });
  });

  it("routes caregiver requests and confirmations", () => {
    expect(routeUtterance("caregiver", "How's Mom doing today?")?.tool).toBe("get_parent_status");
    expect(routeUtterance("caregiver", "Tell Mom I'll visit on Sunday")).toEqual({ tool: "send_message_to_parent", arguments: { text: "I'll visit on Sunday" } });
    expect(routeUtterance("caregiver", "Add Metformin 500mg at 8 PM for Mom")).toEqual({
      tool: "update_medication_schedule",
      arguments: { action: "add", medication: "Metformin", dose: "500 mg", times: ["20:00"] },
    });
    expect(routeUtterance("caregiver", "I'm calling her now")).toEqual({ tool: "acknowledge_alert", arguments: { note: "I'm calling her now" } });
    const pending = { tool: "update_medication_schedule", arguments: { action: "add" } };
    expect(routeUtterance("caregiver", "Yes, go ahead", pending)?.arguments).toEqual({ action: "add", confirm: true });
  });
});
