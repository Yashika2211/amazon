import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../log.js";

/**
 * Simulated Alexa+ client for the demo. It is a real MCP client: it connects to our /mcp endpoint
 * over Streamable HTTP with the persona's OAuth token, lists the tools, and lets Bedrock (Claude
 * tool use via Converse) pick and call them, the same way Alexa+ would. If Bedrock is unavailable,
 * a small keyword router stands in so the demo still runs end to end.
 */

export type Persona = "elder" | "caregiver";

export interface TraceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  ms: number;
  isError: boolean;
  text: string;
}

export interface TurnInput {
  persona: Persona;
  text: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  /** Echoed back from the previous turn when a tool asked for confirmation. */
  pending?: { tool: string; arguments: Record<string, unknown> } | undefined;
}

export interface TurnResult {
  reply: string;
  trace: TraceEntry[];
  orchestrator: string;
  pending?: { tool: string; arguments: Record<string, unknown> };
  totalMs: number;
}

const PERSONA_PROMPT: Record<Persona, string> = {
  elder: "You are speaking with Kamala, 72, at home in Jaipur. She is the parent in this KinLoop household.",
  caregiver: "You are speaking with Arjun in Bengaluru. He is Kamala's son and a family member in this KinLoop household.",
};

function systemPrompt(persona: Persona): string {
  return `You are Alexa, a voice assistant. ${PERSONA_PROMPT[persona]}
Use the KinLoop tools to answer. Call a tool whenever the request relates to medicines, check-ins, symptoms, messages, calls or the parent's day.
When a tool returns text, say that text to the user nearly word for word. It is already written to be spoken. Do not add facts.
Never give medical advice. Keep replies short and natural, with no markdown.
For update_medication_schedule, first call without confirm, ask the user, and only call again with confirm=true after they clearly say yes.`;
}

async function connect(mcpUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: "KinLoop simulated Alexa+ client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function resultText(r: CallToolResult): string {
  return r.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ");
}

async function callTool(client: Client, trace: TraceEntry[], name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const started = performance.now();
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  trace.push({ tool: name, arguments: args, ms: Math.round(performance.now() - started), isError: Boolean(r.isError), text: resultText(r) });
  return r;
}

function pendingFrom(name: string, args: Record<string, unknown>, r: CallToolResult): TurnResult["pending"] {
  const sc = r.structuredContent as { needsConfirmation?: boolean } | undefined;
  return sc?.needsConfirmation ? { tool: name, arguments: args } : undefined;
}

// ───────────── Bedrock orchestrator ─────────────

async function bedrockTurn(client: Client, input: TurnInput, bedrock: BedrockRuntimeClient, modelId: string, trace: TraceEntry[]): Promise<{ reply: string; pending?: TurnResult["pending"] }> {
  const { tools } = await client.listTools();
  const toolConfig = {
    tools: tools.map(
      (t): Tool => ({
        toolSpec: {
          name: t.name,
          description: t.description ?? t.name,
          inputSchema: { json: JSON.parse(JSON.stringify(t.inputSchema)) },
        },
      }),
    ),
  };
  const messages: Message[] = [
    ...input.history.slice(-6).map((h): Message => ({ role: h.role, content: [{ text: h.text }] })),
    { role: "user", content: [{ text: input.text }] },
  ];
  // Converse requires the conversation to start with a user turn.
  while (messages.length && messages[0]!.role !== "user") messages.shift();

  let pending: TurnResult["pending"];
  for (let step = 0; step < 4; step++) {
    const r = await bedrock.send(
      new ConverseCommand({ modelId, system: [{ text: systemPrompt(input.persona) }], messages, toolConfig, inferenceConfig: { maxTokens: 400, temperature: 0 } }),
    );
    const msg = r.output?.message;
    if (!msg) break;
    messages.push(msg);
    const uses = (msg.content ?? []).filter((c): c is ContentBlock.ToolUseMember => "toolUse" in c && Boolean(c.toolUse));
    if (r.stopReason !== "tool_use" || uses.length === 0) {
      const reply = (msg.content ?? []).map((c) => ("text" in c ? c.text : "")).join(" ").trim();
      return { reply: reply || trace.at(-1)?.text || "Okay.", ...(pending ? { pending } : {}) };
    }
    const results: ContentBlock[] = [];
    for (const u of uses) {
      const name = u.toolUse.name!;
      const args = (u.toolUse.input ?? {}) as Record<string, unknown>;
      const res = await callTool(client, trace, name, args);
      pending = pendingFrom(name, args, res) ?? pending;
      results.push({
        toolResult: {
          toolUseId: u.toolUse.toolUseId!,
          content: [{ json: (res.structuredContent ?? { text: resultText(res) }) as never }],
          status: res.isError ? "error" : "success",
        },
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: trace.at(-1)?.text ?? "Sorry, I couldn't finish that.", ...(pending ? { pending } : {}) };
}

// ───────────── Keyword fallback ─────────────

function to24h(h: number, m: number, ampm?: string): string {
  let hh = h % 12;
  if (ampm?.toLowerCase().startsWith("p")) hh += 12;
  if (!ampm && h >= 12) hh = h;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function routeUtterance(persona: Persona, raw: string, pending?: TurnInput["pending"]): { tool: string; arguments: Record<string, unknown> } | null {
  const t = raw.toLowerCase().trim();
  if (pending && /^(yes|yeah|yep|sure|ok(ay)?|go ahead|please do|confirm)/.test(t)) {
    return { tool: pending.tool, arguments: { ...pending.arguments, confirm: true } };
  }
  if (persona === "caregiver") {
    const sched = /\b(add|remove|stop|change)\b\s+([a-z]+)(?:\s+(\d+\s?(?:mg|milligrams?|mcg|ml)))?(?:.*?\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)?/i.exec(raw);
    if (sched) {
      const action = sched[1]!.toLowerCase() === "stop" ? "remove" : (sched[1]!.toLowerCase() as "add" | "remove" | "change");
      const args: Record<string, unknown> = { action, medication: sched[2] };
      if (sched[3]) args.dose = sched[3].replace(/\s?(milligrams?)/i, " mg").replace(/(\d)(mg)/i, "$1 $2");
      if (sched[4]) args.times = [to24h(Number(sched[4]), Number(sched[5] ?? 0), sched[6]?.replace(/\./g, ""))];
      return { tool: "update_medication_schedule", arguments: args };
    }
    const tell = /\b(?:tell|let)\s+(?:mom|mum|ma|amma|dad|papa|her|him|kamala)\s+(?:know\s+)?(?:that\s+)?(.+)/i.exec(raw);
    if (tell) return { tool: "send_message_to_parent", arguments: { text: tell[1]!.replace(/[.?!]+$/, "") } };
    return { tool: "get_parent_status", arguments: {} };
  }
  if (/\b(took|taken|had|just had)\b.*\b(pill|tablet|medicine|dose|amlodipine|metformin|atorvastatin|pills)\b/.test(t)) {
    const all = /\b(all|morning pills|my pills|both)\b/.test(t);
    return { tool: "log_medication", arguments: all ? { allDue: true } : { medication: raw } };
  }
  if (/\b(dizzy|pain|hurt|fell|fall|faint|breath|chest|sick|ache|vomit|fever|weak|numb|confus|slurr|headache|unwell)\b/.test(t)) {
    return { tool: "report_symptom", arguments: { description: raw } };
  }
  if (/\b(call me|ring me|phone me|to call)\b/.test(t)) {
    const who = /\b(?:ask|tell)\s+(my\s+\w+|\w+)\s+to/.exec(t)?.[1];
    return { tool: "request_callback", arguments: who ? { who } : {} };
  }
  if (/\b(message|messages|say anything|said)\b/.test(t)) {
    const from = /\bfrom\s+(my\s+\w+|\w+)/.exec(t)?.[1];
    return { tool: "play_family_messages", arguments: from ? { from } : {} };
  }
  if (/\b(feel|feeling|slept|sleep|mood)\b/.test(t)) {
    let mood = 3;
    if (/\b(great|wonderful|excellent|very good)\b/.test(t)) mood = 5;
    else if (/\b(good|fine|well)\b/.test(t) && !/not (so )?(good|well)/.test(t)) mood = 4;
    else if (/\b(terrible|awful|very low|miserable)\b/.test(t)) mood = 1;
    else if (/\b(low|sad|down|lonely|not good|not well)\b/.test(t)) mood = 2;
    const sleep = /slept (badly|poorly|terribly)|bad sleep|couldn'?t sleep|didn'?t sleep/.test(t)
      ? "poor"
      : /slept (well|great|good)/.test(t)
        ? "good"
        : /slept (okay|ok|alright)/.test(t)
          ? "okay"
          : undefined;
    return { tool: "daily_check_in", arguments: { mood, ...(sleep ? { sleep } : {}), note: raw } };
  }
  return { tool: "get_today_plan", arguments: {} };
}

export interface SimulatorOptions {
  mcpUrl: string;
  token: string;
  bedrock?: { client: BedrockRuntimeClient; modelId: string } | undefined;
}

export async function simulateTurn(input: TurnInput, opts: SimulatorOptions): Promise<TurnResult> {
  const started = performance.now();
  const client = await connect(opts.mcpUrl, opts.token);
  const trace: TraceEntry[] = [];
  try {
    if (opts.bedrock) {
      try {
        const r = await bedrockTurn(client, input, opts.bedrock.client, opts.bedrock.modelId, trace);
        return { reply: r.reply, trace, orchestrator: `bedrock:${opts.bedrock.modelId}`, ...(r.pending ? { pending: r.pending } : {}), totalMs: Math.round(performance.now() - started) };
      } catch (err) {
        log.warn("sim.bedrock_failed", { error: (err as Error).name ?? String(err) });
        if (trace.length) {
          return { reply: trace.at(-1)!.text, trace, orchestrator: "bedrock-partial", totalMs: Math.round(performance.now() - started) };
        }
      }
    }
    const route = routeUtterance(input.persona, input.text, input.pending);
    if (!route) return { reply: "Sorry, I didn't catch that.", trace, orchestrator: "keyword", totalMs: Math.round(performance.now() - started) };
    const r = await callTool(client, trace, route.tool, route.arguments);
    const pending = pendingFrom(route.tool, route.arguments, r);
    return { reply: resultText(r), trace, orchestrator: "keyword", ...(pending ? { pending } : {}), totalMs: Math.round(performance.now() - started) };
  } finally {
    await client.close().catch(() => undefined);
  }
}
