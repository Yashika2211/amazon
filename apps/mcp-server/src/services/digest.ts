import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  doseSlotsForDay,
  localParts,
  moodTrend,
  plural,
  addDays,
  spokenTime,
  summarizeDay,
  RED_FLAG_LABELS,
  type Digest,
} from "@kinloop/core";
import type { Store } from "../store/store.js";
import type { Clock } from "./clock.js";
import { log } from "../log.js";

export const DIGEST_SYSTEM_PROMPT = `You write a short daily update for the adult child of an elderly parent, based only on facts logged by a home voice assistant.

Rules:
- Two or three sentences, warm and plain, under 70 words. No markdown, lists or emoji.
- Only restate facts present in the JSON. Never infer, guess or add anything that is not there.
- Never give medical advice, never diagnose, never interpret symptoms, never suggest treatments or dosage changes.
- If a red-flag alert exists, state it first and plainly, and say the family was alerted.
- Only doses listed under "missed" were missed. Doses under "dueNowNotYetTaken" are not missed; you may say they are due. Never call a dose missed unless it is in "missed".
- Mention missed doses by medicine name and time. Mention mood and sleep if logged.
- Refer to the parent by first name and use the name instead of pronouns. Write in English.`;

export interface DigestFacts {
  elderName: string;
  date: string;
  localTime: string;
  doses: { taken: string[]; missed: string[]; dueNowNotYetTaken: string[]; upcoming: string[] };
  /** Every medicine name on the schedule, for the post-generation check. */
  medicineNames: string[];
  checkIn: { mood: number; sleep?: string; note?: string; at: string } | null;
  moodTrendLastWeek: string;
  symptomsToday: Array<{ text: string; redFlags: string[] }>;
  alertsToday: Array<{ kind: string; reason: string; acknowledged: boolean }>;
  messagesUnheard: number;
}

export async function collectFacts(store: Store, householdId: string, now: Date): Promise<DigestFacts | undefined> {
  const household = await store.getHousehold(householdId);
  if (!household) return undefined;
  const { date, minutes, hhmm } = localParts(now, household.timezone);
  const [members, meds, logs, checkIns, symptoms, alerts, messages] = await Promise.all([
    store.listMembers(householdId),
    store.listMedications(householdId),
    store.listDoseLogs(householdId, date, date),
    store.listCheckIns(householdId, addDays(date, -7)),
    store.listSymptoms(householdId, date),
    store.listAlerts(householdId),
    store.listMessages(householdId),
  ]);
  const elder = members.find((m) => m.id === household.elderMemberId);
  const day = summarizeDay(doseSlotsForDay(meds, logs, minutes));
  const label = (s: { name: string; dose: string; slot: string }) => `${s.name} ${s.dose} at ${spokenTime(s.slot)}`;
  const today = checkIns.find((c) => c.date === date);
  return {
    elderName: elder?.name ?? "your parent",
    date,
    localTime: spokenTime(hhmm),
    doses: {
      taken: day.taken.map(label),
      missed: day.missed.map(label),
      dueNowNotYetTaken: day.pending.map(label),
      upcoming: day.upcoming.map(label),
    },
    medicineNames: meds.filter((m) => m.active).map((m) => m.name),
    checkIn: today
      ? { mood: today.mood, ...(today.sleep ? { sleep: today.sleep } : {}), ...(today.note ? { note: today.note } : {}), at: today.at }
      : null,
    moodTrendLastWeek: moodTrend(checkIns),
    symptomsToday: symptoms.map((s) => ({ text: s.text, redFlags: s.flags.map((f) => RED_FLAG_LABELS[f]) })),
    alertsToday: alerts
      .filter((a) => localParts(new Date(a.createdAt), household.timezone).date === date)
      .map((a) => ({ kind: a.kind, reason: a.reason, acknowledged: Boolean(a.acknowledgedAt) })),
    messagesUnheard: messages.filter((m) => m.kind === "family" && !m.heardAt).length,
  };
}

/** Deterministic digest used when Bedrock is unavailable (local dev, or both models failing). */
export function templateDigest(f: DigestFacts, opts: { includeAlerts?: boolean } = {}): string {
  const parts: string[] = [];
  const urgent = opts.includeAlerts === false ? undefined : f.alertsToday.find((a) => a.kind === "red_flag");
  if (urgent) parts.push(`${urgent.reason.replace(/ Please call now\.$/, "").replace(/\.$/, "")}, and the family was alerted.`);
  const total = f.doses.taken.length + f.doses.missed.length + f.doses.dueNowNotYetTaken.length;
  if (total > 0) {
    parts.push(
      `${f.elderName} has taken ${f.doses.taken.length} of ${plural(total, "dose")} due so far today` +
        (f.doses.missed.length ? `, and missed ${f.doses.missed.join(" and ")}.` : "."),
    );
  } else if (f.doses.upcoming.length) {
    parts.push(`${f.elderName}'s first dose today is ${f.doses.upcoming[0]}.`);
  }
  if (f.checkIn) {
    parts.push(
      `${f.elderName} checked in with a mood of ${f.checkIn.mood} out of 5${f.checkIn.sleep ? ` and ${f.checkIn.sleep} sleep` : ""}.`,
    );
  } else {
    parts.push(`${f.elderName} hasn't checked in yet today.`);
  }
  return parts.join(" ");
}

export interface DigestResult {
  text: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** Brand and generic names a model might mention, to catch medicines that aren't on the schedule. */
const COMMON_MEDICINES = [
  "aspirin", "paracetamol", "acetaminophen", "ibuprofen", "insulin", "metformin", "amlodipine", "atorvastatin",
  "lisinopril", "losartan", "levothyroxine", "omeprazole", "warfarin", "clopidogrel", "glimepiride", "telmisartan",
];

/**
 * Deterministic check on model output before anyone hears it. Returns the reason it was rejected,
 * or null if it only states things the facts support.
 */
export function checkDigest(text: string, f: DigestFacts): string | null {
  const t = text.toLowerCase();
  if (!t.trim()) return "empty";
  if (/\bmiss(ed|ing)\b/.test(t) && f.doses.missed.length === 0) return "claims a missed dose but none were missed";
  const known = new Set(f.medicineNames.map((n) => n.toLowerCase()));
  const unknown = COMMON_MEDICINES.find((m) => t.includes(m) && !known.has(m));
  if (unknown) return `mentions a medicine not on the schedule (${unknown})`;
  if (/\b(you should|i recommend|consult|diagnos|treatment|increase the dose|reduce the dose)/.test(t)) return "gives advice";
  if (f.alertsToday.some((a) => a.kind === "red_flag") && !/(alert|fain|chest|breath|fall|fell|confus|stroke)/.test(t)) return "omits today's red-flag alert";
  return null;
}

export async function writeDigestWithBedrock(
  facts: DigestFacts,
  client: BedrockRuntimeClient,
  modelIds: string[],
): Promise<DigestResult> {
  for (const modelId of modelIds) {
    const started = Date.now();
    try {
      const r = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: DIGEST_SYSTEM_PROMPT }],
          messages: [{ role: "user", content: [{ text: `Facts (JSON):\n${JSON.stringify(facts)}` }] }],
          inferenceConfig: { maxTokens: 200, temperature: 0.2 },
        }),
      );
      const text = r.output?.message?.content?.map((c) => c.text ?? "").join("").trim() ?? "";
      const rejected = checkDigest(text, facts);
      if (rejected) {
        log.warn("digest.rejected", { modelId, reason: rejected });
        continue;
      }
      const result = {
        text,
        modelId,
        latencyMs: Date.now() - started,
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
      };
      log.info("digest.bedrock", { modelId, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      return result;
    } catch (err) {
      log.warn("digest.bedrock_failed", { modelId, latencyMs: Date.now() - started, error: (err as Error).name ?? String(err) });
    }
  }
  return { text: templateDigest(facts), modelId: "template", latencyMs: 0, inputTokens: 0, outputTokens: 0 };
}

export interface DigestWriter {
  write(facts: DigestFacts): Promise<DigestResult>;
}

export const templateWriter: DigestWriter = {
  async write(facts) {
    return { text: templateDigest(facts), modelId: "template", latencyMs: 0, inputTokens: 0, outputTokens: 0 };
  },
};

export function bedrockWriter(region: string, modelIds: string[]): DigestWriter {
  const client = new BedrockRuntimeClient({ region });
  return { write: (facts) => writeDigestWithBedrock(facts, client, modelIds) };
}

/** Computes and stores today's digest. Runs off the request path (async Lambda or background task). */
export async function refreshDigest(store: Store, writer: DigestWriter, householdId: string, clock: Clock): Promise<Digest | undefined> {
  const now = clock.now();
  const facts = await collectFacts(store, householdId, now);
  if (!facts) return undefined;
  const r = await writer.write(facts);
  const digest: Digest = { householdId, date: facts.date, ...r, generatedAt: now.toISOString() };
  await store.putDigest(digest);
  return digest;
}

/** Asks for a digest refresh without waiting for it. */
export interface DigestTrigger {
  request(householdId: string): void;
  /** Resolves when queued work is done (tests and local only). */
  idle(): Promise<void>;
}

export class InProcessDigestTrigger implements DigestTrigger {
  private pending = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    private writer: DigestWriter,
    private clock: Clock,
  ) {}

  request(householdId: string): void {
    const prev = this.pending.get(householdId) ?? Promise.resolve();
    const next = prev
      .then(() => refreshDigest(this.store, this.writer, householdId, this.clock))
      .then(() => undefined)
      .catch((err) => log.error("digest.failed", { error: String(err) }));
    this.pending.set(householdId, next);
  }

  async idle(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}

/** Fire-and-forget async Lambda invoke (InvocationType=Event), so the MCP response never waits on Bedrock. */
export class LambdaDigestTrigger implements DigestTrigger {
  private inflight: Array<Promise<unknown>> = [];
  private client = new LambdaClient({});
  constructor(private functionName: string) {}

  request(householdId: string): void {
    const p = this.client
      .send(
        new InvokeCommand({
          FunctionName: this.functionName,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ householdId })),
        }),
      )
      .catch((err) => log.error("digest.invoke_failed", { error: String(err) }));
    this.inflight.push(p);
  }

  async idle(): Promise<void> {
    await Promise.all(this.inflight.splice(0));
  }
}
