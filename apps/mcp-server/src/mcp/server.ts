import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "../log.js";
import type { Deps } from "../services/deps.js";
import * as k from "../services/kinloop.js";
import { SpokenError, type AuthContext, type Outcome } from "../services/kinloop.js";
import { registerUiResources, UI } from "./ui.js";

export const SERVER_INFO = { name: "kinloop", title: "KinLoop", version: "1.0.0" } as const;

/** Spoken fallbacks when Alexa+ sends arguments that fail schema validation. */
const VALIDATION_HINTS: Record<string, string> = {
  log_medication: "Which medicine did you take? You can say its name, like Metformin, or what it's for, like your blood pressure pill.",
  daily_check_in: "How are you feeling today, on a scale of one to five, where one is very low and five is great?",
  report_symptom: "Tell me in a few words how you're feeling.",
  request_callback: "Who would you like a call from?",
  play_family_messages: "Whose messages would you like to hear?",
  send_message_to_parent: "What would you like me to tell them? Keep it to a sentence or two.",
  update_medication_schedule:
    "Tell me the medicine, and whether to add, change or remove it. For a new medicine I also need the dose and the time, like 500 milligrams at 8 PM.",
};

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_IDEMPOTENT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Sends a notification to someone outside the conversation. */
const NOTIFY: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function toResult(o: Outcome, uiUri?: string): CallToolResult {
  return {
    content: [{ type: "text", text: o.speech }],
    structuredContent: { ...o.data, speech: o.speech },
    ...(uiUri ? { _meta: { ui: { resourceUri: uiUri } } } : {}),
  };
}

function spokenError(tool: string, err: unknown): CallToolResult {
  if (err instanceof SpokenError) {
    return { isError: true, content: [{ type: "text", text: err.speech }], structuredContent: { error: err.code, message: err.speech } };
  }
  log.error("tool.failed", { tool, error: err instanceof Error ? err.message : String(err) });
  const speech = "Sorry, something went wrong on my side. Please try again in a minute.";
  return { isError: true, content: [{ type: "text", text: speech }], structuredContent: { error: "internal_error", message: speech } };
}

/**
 * Builds a fresh, stateless MCP server bound to one authenticated caller.
 * A new instance per HTTP request: no session state lives on the server.
 */
export function createMcpServer(deps: Deps, ctx: AuthContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
    instructions:
      "KinLoop helps an elderly parent manage their day by voice, and keeps their family informed. " +
      "Elder tools: get_today_plan, log_medication, daily_check_in, report_symptom, request_callback, play_family_messages. " +
      "Family tools: get_parent_status, send_message_to_parent, update_medication_schedule. " +
      "Speak tool text as written. KinLoop is not a medical device and does not replace emergency services.",
  });

  // Replace the SDK's technical validation message with a spoken prompt for the missing detail.
  const proto = server as unknown as { createToolError: (msg: string) => CallToolResult };
  proto.createToolError = (msg: string) => {
    const tool = /for tool ([a-z_]+)/.exec(msg)?.[1] ?? "";
    const speech = VALIDATION_HINTS[tool] ?? "Sorry, I didn't catch that. Could you say it another way?";
    log.warn("tool.invalid_arguments", { tool });
    return { isError: true, content: [{ type: "text", text: speech }], structuredContent: { error: "invalid_arguments", message: speech } };
  };

  const run = <A>(name: string, fn: (args: A) => Promise<Outcome>, uiUri?: string) => async (args: A) => {
    const started = Date.now();
    try {
      const out = await fn(args);
      log.info("tool.ok", { tool: name, ms: Date.now() - started, role: ctx.role });
      return toResult(out, uiUri);
    } catch (err) {
      return spokenError(name, err);
    }
  };

  // ─────────── Elder-facing ───────────
  server.registerTool(
    "get_today_plan",
    {
      title: "Today's plan",
      description:
        "Reads out today's plan for the elderly parent: each medicine with its time and whether it has been taken, today's appointments, any gentle reminders, and how many family messages are waiting. Use when the parent asks what they need to do today, what medicines are left, or what's on today. Read-only.",
      inputSchema: {},
      annotations: { ...READ, title: "Today's plan" },
      _meta: { ui: { resourceUri: UI.todayPlan } },
    },
    run("get_today_plan", () => k.getTodayPlan(deps, ctx), UI.todayPlan),
  );

  server.registerTool(
    "log_medication",
    {
      title: "Log a medicine",
      description:
        "Marks a scheduled medicine dose as taken right now, when the parent says they just took a pill. Matches the medicine by name (\"Metformin\") or purpose (\"blood pressure pill\", \"sugar tablet\") to the nearest scheduled dose. Safe to retry: logging the same dose twice does not double-count. If the medicine is unclear, leave `medication` empty and the tool asks which one.",
      inputSchema: {
        medication: z
          .string()
          .max(80)
          .optional()
          .describe("The parent's own words for the medicine, copied as said, e.g. \"Metformin\", \"my blood pressure pill\" or \"sugar tablet\". Always pass this when the parent named or described the medicine; omit only if they just said \"my pill\"."),
        allDue: z
          .boolean()
          .optional()
          .describe("True when the parent says they took all of the medicines that are due now, e.g. \"I took my morning pills\"."),
      },
      annotations: { ...WRITE_IDEMPOTENT, title: "Log a medicine" },
    },
    run("log_medication", (a: k.LogMedicationInput) => k.logMedication(deps, ctx, a)),
  );

  server.registerTool(
    "daily_check_in",
    {
      title: "Daily check-in",
      description:
        "Records the parent's daily wellbeing check-in: mood from 1 to 5, how they slept, and an optional short note. Use when the parent says how they are feeling or how they slept, e.g. \"I'm feeling okay, slept badly\". Map words to mood: very low or terrible = 1, low or sad = 2, okay = 3, good = 4, great = 5. For pain or physical symptoms use report_symptom instead.",
      inputSchema: {
        mood: z.number().int().min(1).max(5).describe("Mood from 1 (very low) to 5 (great)."),
        sleep: z.enum(["good", "okay", "poor"]).optional().describe("How the parent slept last night. \"Slept badly\" = poor."),
        note: z.string().max(280).optional().describe("Anything else the parent mentioned, in their words. Optional."),
      },
      annotations: { ...WRITE_IDEMPOTENT, title: "Daily check-in" },
    },
    run("daily_check_in", (a: k.CheckInInput) => k.dailyCheckIn(deps, ctx, a)),
  );

  server.registerTool(
    "report_symptom",
    {
      title: "Report a symptom",
      description:
        "Records a physical symptom or health event the parent describes, e.g. \"I'm feeling dizzy\" or \"I fell in the bathroom\". Fixed safety rules (not AI) check for red flags: chest pain, trouble breathing, a fall, fainting, confusion or stroke signs. A red flag alerts the family immediately and the response tells the parent to call emergency services. Always pass the parent's own words.",
      inputSchema: {
        description: z.string().min(2).max(400).describe("The parent's own words describing the symptom, unchanged."),
      },
      annotations: { ...NOTIFY, title: "Report a symptom" },
    },
    run("report_symptom", (a: { description: string }) => k.reportSymptom(deps, ctx, a)),
  );

  server.registerTool(
    "request_callback",
    {
      title: "Ask family to call",
      description:
        "Sends a \"please call me\" notification to the parent's family. Use when the parent says \"ask my son to call me\" or \"tell Arjun to ring me\". Repeated requests within 15 minutes are merged into one.",
      inputSchema: {
        who: z.string().max(60).optional().describe("Who should call: a name or relation such as \"my son\" or \"Arjun\". Omit to notify all family members."),
        reason: z.string().max(200).optional().describe("Optional short reason the parent gave."),
      },
      annotations: { ...NOTIFY, title: "Ask family to call" },
    },
    run("request_callback", (a: { who?: string; reason?: string }) => k.requestCallback(deps, ctx, a)),
  );

  server.registerTool(
    "play_family_messages",
    {
      title: "Play family messages",
      description:
        "Reads out new messages the family has left for the parent, and any gentle medicine reminders, then marks them as heard. Use when the parent asks \"any messages?\" or \"did my daughter say anything?\".",
      inputSchema: {
        from: z.string().max(60).optional().describe("Only messages from this person, e.g. \"my daughter\" or \"Arjun\". Omit for all."),
      },
      annotations: { ...WRITE, title: "Play family messages" },
    },
    run("play_family_messages", (a: { from?: string }) => k.playFamilyMessages(deps, ctx, a)),
  );

  // ─────────── Family-facing ───────────
  server.registerTool(
    "get_parent_status",
    {
      title: "How is my parent doing",
      description:
        "For a family member asking about their parent, e.g. \"How's Mom doing today?\". Returns doses taken and missed today, the latest check-in and mood trend, any alerts, and a short daily summary. Read-only.",
      inputSchema: {},
      annotations: { ...READ, title: "How is my parent doing" },
      _meta: { ui: { resourceUri: UI.parentStatus } },
    },
    run("get_parent_status", () => k.getParentStatus(deps, ctx), UI.parentStatus),
  );

  server.registerTool(
    "send_message_to_parent",
    {
      title: "Message my parent",
      description:
        "Leaves a short message from a family member for the parent, read out the next time the parent talks to Alexa. Use for \"Tell Dad I'll visit on Sunday\". Pass the message as it should be heard, e.g. \"I'll visit on Sunday\".",
      inputSchema: {
        text: z.string().min(1).max(300).describe("The message to pass on, phrased in first person as the family member said it."),
      },
      annotations: { ...WRITE, title: "Message my parent" },
    },
    run("send_message_to_parent", (a: { text: string }) => k.sendMessageToParent(deps, ctx, a)),
  );

  server.registerTool(
    "update_medication_schedule",
    {
      title: "Change medicine schedule",
      description:
        "Adds, changes or removes a medicine on the parent's schedule. Family members only. Two steps: first call without `confirm` and read the summary back to the user. Only after the user clearly says yes, call again with the same arguments and confirm=true. Example: \"Add Metformin 500mg at 8 PM for Mom\" → action=add, medication=Metformin, dose=500 mg, times=[\"20:00\"].",
      inputSchema: {
        action: z.enum(["add", "change", "remove"]).describe("add a new medicine, change an existing one's dose or times, or remove it."),
        medication: z.string().min(2).max(80).describe("Medicine name, e.g. \"Metformin\"."),
        dose: z.string().max(40).optional().describe("Dose with unit, e.g. \"500 mg\". Required for add."),
        times: z
          .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
          .min(1)
          .max(6)
          .optional()
          .describe("Local times in 24-hour HH:MM, e.g. [\"08:00\", \"20:00\"]. Required for add."),
        purpose: z.string().max(60).optional().describe("Plain-language purpose, e.g. \"diabetes\". Optional."),
        confirm: z.boolean().optional().describe("Set true only after the user confirmed the summary from the first call."),
      },
      annotations: { ...DESTRUCTIVE, title: "Change medicine schedule" },
    },
    run("update_medication_schedule", (a: k.ScheduleInput) => k.updateMedicationSchedule(deps, ctx, a)),
  );

  registerUiResources(server);
  return server;
}
