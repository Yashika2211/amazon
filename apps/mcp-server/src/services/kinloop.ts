import { randomUUID } from "node:crypto";
import {
  addDays,
  adherence,
  callbackAlert,
  classifySymptom,
  doseSlotsForDay,
  evaluateLowMood,
  isHHMM,
  localParts,
  matchDose,
  medicationMatches,
  moodTrend,
  plural,
  redFlagAlert,
  RED_FLAG_LABELS,
  speakable,
  spokenList,
  spokenTime,
  summarizeDay,
  type DoseSlot,
  type FamilyMessage,
  type Household,
  type Medication,
  type Member,
  type Role,
  type SleepQuality,
} from "@kinloop/core";
import { collectFacts, templateDigest } from "./digest.js";
import { escalateHousehold, raiseAlert } from "./escalation.js";
import type { Deps } from "./deps.js";

/** Who is calling, taken from the verified access token. Never from tool arguments. */
export interface AuthContext {
  householdId: string;
  memberId: string;
  role: Role;
  clientId: string;
}

/** A tool result: `speech` is what Alexa says, `data` is the same facts as structured content. */
export interface Outcome<T extends object = Record<string, unknown>> {
  speech: string;
  data: T;
}

/** An expected failure, phrased as a short spoken sentence. */
export class SpokenError extends Error {
  constructor(
    public speech: string,
    public code = "invalid_request",
  ) {
    super(speech);
  }
}

interface Loaded {
  household: Household;
  members: Member[];
  me: Member;
  elder: Member;
  caregivers: Member[];
  now: Date;
  date: string;
  minutes: number;
  hhmm: string;
}

async function load(deps: Deps, ctx: AuthContext): Promise<Loaded> {
  const [household, members] = await Promise.all([
    deps.store.getHousehold(ctx.householdId),
    deps.store.listMembers(ctx.householdId),
  ]);
  if (!household) throw new SpokenError("I couldn't find your KinLoop household. Please link your account again.", "not_found");
  const me = members.find((m) => m.id === ctx.memberId);
  const elder = members.find((m) => m.id === household.elderMemberId);
  if (!me || !elder) throw new SpokenError("I couldn't find your KinLoop profile. Please link your account again.", "not_found");
  const now = deps.clock.now();
  const { date, minutes, hhmm } = localParts(now, household.timezone);
  return { household, members, me, elder, caregivers: members.filter((m) => m.role === "caregiver"), now, date, minutes, hhmm };
}

function requireRole(l: Loaded, role: Role): void {
  if (l.me.role === role) return;
  if (role === "elder") {
    throw new SpokenError(`Only ${l.elder.name} can log that, from ${l.elder.name}'s own Alexa.`, "forbidden");
  }
  throw new SpokenError(`That's a family setting. A family member can change it from their own Alexa or the KinLoop dashboard.`, "forbidden");
}

const doseLabel = (s: { name: string; dose: string }) => `${s.name} ${s.dose}`;

function groupByTime(slots: DoseSlot[]): string {
  const byTime = new Map<string, string[]>();
  for (const s of slots) byTime.set(s.slot, [...(byTime.get(s.slot) ?? []), doseLabel(s)]);
  return spokenList([...byTime.entries()].map(([t, names]) => `${spokenList(names)} at ${spokenTime(t)}`));
}

function ago(fromIso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(fromIso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.round(hours / 24), "day")} ago`;
}

function greeting(minutes: number): string {
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 17 * 60) return "Good afternoon";
  return "Good evening";
}

async function afterWrite(deps: Deps, l: Loaded): Promise<void> {
  await deps.store.touchActivity(l.household.id, l.now.toISOString());
  await escalateHousehold(deps, l.household.id);
  deps.digest.request(l.household.id);
}

function slotData(s: DoseSlot) {
  return {
    medication: s.name,
    dose: s.dose,
    time: s.slot,
    status: s.status,
    ...(s.takenAt ? { takenAt: s.takenAt } : {}),
  };
}

// ───────────────────────────── Elder-facing ─────────────────────────────

export async function getTodayPlan(deps: Deps, ctx: AuthContext): Promise<Outcome> {
  const l = await load(deps, ctx);
  const [meds, logs, appts, messages] = await Promise.all([
    deps.store.listMedications(l.household.id),
    deps.store.listDoseLogs(l.household.id, l.date, l.date),
    deps.store.listAppointments(l.household.id, l.date),
    deps.store.listMessages(l.household.id),
  ]);
  const slots = doseSlotsForDay(meds, logs, l.minutes);
  const day = summarizeDay(slots);
  const unheard = messages.filter((m) => m.kind === "family" && !m.heardAt);
  const reminders = messages.filter((m) => m.kind === "reminder" && !m.heardAt);
  const isElder = l.me.role === "elder";
  const who = isElder ? "you" : l.elder.name;

  const parts: string[] = [];
  parts.push(isElder ? `${greeting(l.minutes)}, ${l.elder.name}.` : `Here's ${l.elder.name}'s day.`);
  if (reminders.length) parts.push(reminders.map((r) => r.text).join(" "));
  if (slots.length === 0) {
    parts.push(`There are no medicines scheduled today.`);
  } else {
    const remaining = [...day.missed, ...day.pending, ...day.upcoming];
    if (remaining.length === 0) parts.push(`All ${plural(slots.length, "dose")} for today are done. Well done.`);
    else {
      if (day.pending.length || day.missed.length) parts.push(`Still to take from earlier: ${groupByTime([...day.missed, ...day.pending])}.`);
      if (day.upcoming.length) parts.push(`Coming up: ${groupByTime(day.upcoming)}.`);
      if (day.taken.length) parts.push(`${isElder ? "You've" : `${l.elder.name} has`} already taken ${plural(day.taken.length, "dose")}.`);
    }
  }
  const upcomingAppts = appts.filter((a) => a.time >= l.hhmm);
  if (upcomingAppts.length) {
    parts.push(`${isElder ? "You have" : `${l.elder.name} has`} ${spokenList(upcomingAppts.map((a) => `${a.title} at ${spokenTime(a.time)}`))}.`);
  }
  if (unheard.length) {
    const from = [...new Set(unheard.map((m) => m.fromName))];
    const play = unheard.length === 1 ? "Just ask me to play it." : "Just ask me to play them.";
    parts.push(`${spokenList(from)} left ${who} ${plural(unheard.length, "message")}.${isElder ? ` ${play}` : ""}`);
  }
  if (isElder && reminders.length) {
    await deps.store.markHeard(l.household.id, reminders.map((r) => r.id), l.now.toISOString());
  }

  return {
    speech: speakable(parts.join(" ")),
    data: {
      date: l.date,
      localTime: l.hhmm,
      elderName: l.elder.name,
      medications: slots.map(slotData),
      appointments: appts.map((a) => ({ title: a.title, time: a.time })),
      unheardMessages: unheard.length,
      reminders: reminders.map((r) => r.text),
    },
  };
}

export interface LogMedicationInput {
  medication?: string | undefined;
  allDue?: boolean | undefined;
}

export async function logMedication(deps: Deps, ctx: AuthContext, input: LogMedicationInput): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "elder");
  const [meds, logs] = await Promise.all([
    deps.store.listMedications(l.household.id),
    deps.store.listDoseLogs(l.household.id, l.date, l.date),
  ]);

  const record = async (medicationId: string, slot: string) =>
    deps.store.putDoseLogIfAbsent({
      householdId: l.household.id,
      date: l.date,
      medicationId,
      slot,
      takenAt: l.now.toISOString(),
      loggedBy: l.me.id,
    });

  if (input.allDue && !input.medication) {
    const due = doseSlotsForDay(meds, logs, l.minutes + 60).filter((s) => s.status !== "taken" && s.status !== "upcoming");
    if (due.length === 0) {
      return { speech: "You're all caught up. There are no doses due right now.", data: { logged: [], alreadyLogged: true } };
    }
    for (const s of due) await record(s.medicationId, s.slot);
    await afterWrite(deps, l);
    return {
      speech: `Got it. I've marked ${spokenList(due.map(doseLabel))} as taken.`,
      data: { logged: due.map((s) => ({ medication: s.name, dose: s.dose, time: s.slot })), alreadyLogged: false },
    };
  }

  const m = matchDose(meds, logs, l.minutes, input.medication);
  switch (m.kind) {
    case "no_medications":
      return { speech: "You don't have any medicines on your schedule yet.", data: { logged: [] } };
    case "unknown_medication": {
      const names = meds.filter((x) => x.active).map((x) => x.name);
      return {
        speech: `I couldn't find ${input.medication} on your schedule. Your medicines are ${spokenList(names)}. Which one did you take?`,
        data: { logged: [], unknown: input.medication, options: names },
      };
    }
    case "ambiguous":
      return {
        speech: `Which one did you take: ${spokenList(m.options.map((o) => o.medication.name)).replace(/, and | and /, " or ")}? You can also say all of them.`,
        data: { logged: [], needsClarification: true, options: m.options.map((o) => ({ medication: o.medication.name, time: o.slot })) },
      };
    case "not_due":
      return {
        speech: `Your ${doseLabel(m.medication)} isn't due until ${spokenTime(m.nextSlot)}, so I haven't marked it yet. Tell me again when you take it.`,
        data: { logged: [], notDueUntil: m.nextSlot, medication: m.medication.name },
      };
    case "already_logged":
      return {
        speech: `You've already logged your ${doseLabel(m.medication)} for ${spokenTime(m.slot)}, ${ago(m.takenAt, l.now)}. No need to take another.`,
        data: { logged: [], alreadyLogged: true, medication: m.medication.name, time: m.slot, takenAt: m.takenAt },
      };
    case "match": {
      const created = await record(m.medication.id, m.slot);
      if (created) await afterWrite(deps, l);
      const next = doseSlotsForDay(meds, [...logs, { householdId: "", date: l.date, medicationId: m.medication.id, slot: m.slot, takenAt: "", loggedBy: "" }], l.minutes).find(
        (s) => s.status === "upcoming",
      );
      return {
        speech:
          `Got it. Your ${doseLabel(m.medication)} for ${spokenTime(m.slot)} is marked as taken.` +
          (next ? ` Next is ${doseLabel(next)} at ${spokenTime(next.slot)}.` : " That's everything for today."),
        data: {
          logged: [{ medication: m.medication.name, dose: m.medication.dose, time: m.slot }],
          alreadyLogged: !created,
          ...(next ? { next: { medication: next.name, time: next.slot } } : {}),
        },
      };
    }
  }
}

const MOOD_WORDS = ["", "very low", "low", "okay", "good", "great"];

export interface CheckInInput {
  mood: number;
  sleep?: SleepQuality | undefined;
  note?: string | undefined;
}

export async function dailyCheckIn(deps: Deps, ctx: AuthContext, input: CheckInInput): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "elder");
  await deps.store.putCheckIn({
    householdId: l.household.id,
    date: l.date,
    at: l.now.toISOString(),
    mood: input.mood,
    ...(input.sleep ? { sleep: input.sleep } : {}),
    ...(input.note ? { note: input.note } : {}),
  });
  await afterWrite(deps, l);
  const checkIns = await deps.store.listCheckIns(l.household.id, addDays(l.date, -10));
  const lowStreak = evaluateLowMood(checkIns, l.date, l.elder.name) !== null;
  const sleepPart = input.sleep ? ` and that you slept ${input.sleep === "poor" ? "badly" : input.sleep === "okay" ? "okay" : "well"}` : "";
  const caregiver = l.caregivers[0];
  let follow = "I'll let your family know in today's update.";
  if (input.mood <= 2 && caregiver) follow = `I'm sorry you're feeling low. Would you like me to ask ${caregiver.name} to call you?`;
  return {
    speech: `Thank you, ${l.elder.name}. I've noted that you're feeling ${MOOD_WORDS[input.mood]}${sleepPart}. ${follow}`,
    data: { date: l.date, mood: input.mood, sleep: input.sleep ?? null, noted: Boolean(input.note), lowMoodStreak: lowStreak },
  };
}

export async function reportSymptom(deps: Deps, ctx: AuthContext, input: { description: string }): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "elder");
  const flags = classifySymptom(input.description);
  const symptom = {
    id: randomUUID(),
    householdId: l.household.id,
    at: l.now.toISOString(),
    date: l.date,
    text: input.description,
    flags,
  };
  await deps.store.putSymptom(symptom);

  const family = l.caregivers.length ? spokenList(l.caregivers.map((c) => c.name)) : "your family";
  if (flags.length > 0) {
    const recent = await deps.store.listAlerts(l.household.id, new Date(l.now.getTime() - 60 * 60000).toISOString());
    const alert = redFlagAlert(symptom, l.elder.name, recent);
    if (alert) await raiseAlert(deps, alert);
    await deps.store.touchActivity(l.household.id, l.now.toISOString());
    deps.digest.request(l.household.id);
    const labels = spokenList(flags.map((f) => RED_FLAG_LABELS[f]));
    return {
      speech: `${l.elder.name}, ${labels} can be serious. Please call ${l.household.emergencyNumber} now, or ask someone nearby to help you. I've alerted ${family}${alert ? "" : " again"}. I can't call emergency services for you.`,
      data: {
        redFlag: true,
        flags,
        familyAlerted: true,
        newIncident: Boolean(alert),
        emergencyNumber: l.household.emergencyNumber,
        disclaimer: "KinLoop is not a medical device and does not replace emergency services.",
      },
    };
  }
  await afterWrite(deps, l);
  return {
    speech: `I've noted that, and I'll include it in today's update for ${family}. If it gets worse, or you have chest pain, trouble breathing, or a fall, tell me right away or call ${l.household.emergencyNumber}.`,
    data: { redFlag: false, flags: [], familyAlerted: false, emergencyNumber: l.household.emergencyNumber },
  };
}

function findCaregiver(l: Loaded, who?: string): Member[] {
  if (!who) return l.caregivers;
  const q = who.toLowerCase();
  const match = l.caregivers.filter((c) => q.includes(c.name.toLowerCase()) || (c.relation && q.includes(c.relation.toLowerCase())));
  return match.length ? match : l.caregivers;
}

export async function requestCallback(deps: Deps, ctx: AuthContext, input: { who?: string | undefined; reason?: string | undefined }): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "elder");
  const targets = findCaregiver(l, input.who);
  if (targets.length === 0) {
    return { speech: "There's no family member linked to KinLoop yet, so I can't send that.", data: { notified: [] } };
  }
  const recent = await deps.store.listAlerts(l.household.id, new Date(l.now.getTime() - 60 * 60000).toISOString());
  const names = targets.map((t) => t.name);
  const alert = callbackAlert(l.household.id, l.elder.name, spokenList(names), l.now.toISOString(), recent, input.reason);
  if (alert) await raiseAlert(deps, alert);
  await deps.store.touchActivity(l.household.id, l.now.toISOString());
  return {
    speech: alert
      ? `Okay. I've let ${spokenList(names)} know you'd like a call.`
      : `I already asked ${spokenList(names)} to call you a few minutes ago. I'll remind them if you like, just ask again later.`,
    data: { notified: names, duplicate: !alert },
  };
}

export async function playFamilyMessages(deps: Deps, ctx: AuthContext, input: { from?: string | undefined }): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "elder");
  const all = await deps.store.listMessages(l.household.id);
  let msgs = all.filter((m) => !m.heardAt);
  if (input.from) {
    const q = input.from.toLowerCase();
    const senders = l.caregivers.filter((c) => q.includes(c.name.toLowerCase()) || (c.relation && q.includes(c.relation)));
    if (senders.length) msgs = msgs.filter((m) => senders.some((s) => s.id === m.fromMemberId));
  }
  const family = msgs.filter((m) => m.kind === "family");
  const reminders = msgs.filter((m) => m.kind === "reminder");
  if (family.length === 0 && reminders.length === 0) {
    const caregiver = l.caregivers[0];
    return {
      speech: `There are no new messages${input.from ? ` from ${input.from}` : ""}.${caregiver ? ` Would you like me to ask ${caregiver.name} to call you?` : ""}`,
      data: { messages: [] },
    };
  }
  const spoken = family.map((m: FamilyMessage) => `From ${m.fromName}, ${ago(m.createdAt, l.now)}: ${m.text}`);
  const intro = family.length ? `You have ${plural(family.length, "new message")}.` : "";
  await deps.store.markHeard(l.household.id, msgs.map((m) => m.id), l.now.toISOString());
  return {
    speech: speakable([intro, ...spoken, ...reminders.map((r) => r.text)].filter(Boolean).join(" ")),
    data: {
      messages: family.map((m) => ({ from: m.fromName, text: m.text, sentAt: m.createdAt })),
      reminders: reminders.map((r) => r.text),
    },
  };
}

// ───────────────────────────── Family-facing ─────────────────────────────

export async function getParentStatus(deps: Deps, ctx: AuthContext): Promise<Outcome> {
  const l = await load(deps, ctx);
  const since = addDays(l.date, -7);
  const [meds, logs, checkIns, alerts, digest, lastActivity] = await Promise.all([
    deps.store.listMedications(l.household.id),
    deps.store.listDoseLogs(l.household.id, since, l.date),
    deps.store.listCheckIns(l.household.id, since),
    deps.store.listAlerts(l.household.id),
    deps.store.getDigest(l.household.id, l.date),
    deps.store.lastActivity(l.household.id),
  ]);
  const todaysLogs = logs.filter((x) => x.date === l.date);
  const day = summarizeDay(doseSlotsForDay(meds, todaysLogs, l.minutes));
  const today = checkIns.find((c) => c.date === l.date);
  const lastCheckIn = [...checkIns].sort((a, b) => b.at.localeCompare(a.at))[0];
  const todaysAlerts = alerts.filter((a) => localParts(new Date(a.createdAt), l.household.timezone).date === l.date);
  const open = todaysAlerts.filter((a) => !a.acknowledgedAt);
  const urgent = open.filter((a) => a.severity === "urgent");
  const trend = moodTrend(checkIns);

  // The Bedrock digest is precomputed. If something was logged after it was written, speak the
  // deterministic summary instead so the family never hears stale facts.
  const fresh = digest && (!lastActivity || digest.generatedAt >= lastActivity);
  let summary: string;
  let digestSource: string;
  const facts = fresh && !urgent.length ? undefined : await collectFacts(deps.store, l.household.id, l.now);
  if (fresh) {
    summary = digest.text;
    digestSource = digest.modelId;
  } else {
    summary = templateDigest(facts!);
    digestSource = "live-template";
  }

  const parts: string[] = [];
  if (urgent.length) {
    // Lead with the urgent alert, then the plain facts, so the alert is never said twice.
    parts.push(`Urgent: ${urgent[0]!.reason}`);
    parts.push(templateDigest(facts!, { includeAlerts: false }));
  } else {
    parts.push(summary);
  }
  const otherOpen = open.filter((a) => a.severity !== "urgent");
  if (otherOpen.length) parts.push(`There ${otherOpen.length === 1 ? "is" : "are"} also ${plural(otherOpen.length, "open alert")}: ${otherOpen.map((a) => a.reason).join(" ")}`);
  if (trend === "declining") parts.push(`${l.elder.name}'s mood has been lower than usual this week.`);

  const week = adherence(meds, logs, l.date, l.minutes, 7);
  return {
    speech: speakable(parts.join(" ")),
    data: {
      elderName: l.elder.name,
      date: l.date,
      localTime: l.hhmm,
      doses: {
        taken: day.taken.map(slotData),
        missed: day.missed.map(slotData),
        pending: day.pending.map(slotData),
        upcoming: day.upcoming.map(slotData),
      },
      lastCheckIn: lastCheckIn ? { date: lastCheckIn.date, at: lastCheckIn.at, mood: lastCheckIn.mood, sleep: lastCheckIn.sleep ?? null } : null,
      checkedInToday: Boolean(today),
      moodTrend: trend,
      alertsToday: todaysAlerts.map((a) => ({ kind: a.kind, severity: a.severity, reason: a.reason, at: a.createdAt, acknowledged: Boolean(a.acknowledgedAt) })),
      digest: { text: summary, source: digestSource, generatedAt: fresh ? digest.generatedAt : l.now.toISOString() },
      adherence7d: week,
    },
  };
}

export async function sendMessageToParent(deps: Deps, ctx: AuthContext, input: { text: string }): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "caregiver");
  const msg: FamilyMessage = {
    id: `${l.now.toISOString()}-${randomUUID().slice(0, 8)}`,
    householdId: l.household.id,
    kind: "family",
    fromMemberId: l.me.id,
    fromName: l.me.name,
    text: input.text,
    createdAt: l.now.toISOString(),
  };
  await deps.store.putMessage(msg);
  await deps.store.touchActivity(l.household.id, l.now.toISOString());
  return {
    speech: `Okay. I'll pass this on to ${l.elder.name}: ${input.text}. It will be read out the next time ${l.elder.name} talks to Alexa.`,
    data: { queued: true, to: l.elder.name, text: input.text },
  };
}

/**
 * Family member says "I'm calling her now": open alerts are marked handled, and the parent hears
 * at their next interaction that the family saw it. Safe to repeat: nothing open means no-op.
 */
export async function acknowledgeAlert(
  deps: Deps,
  ctx: AuthContext,
  input: { note?: string | undefined; incidentKey?: string | undefined },
): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "caregiver");
  const since = new Date(l.now.getTime() - 24 * 3600_000).toISOString();
  const open = (await deps.store.listAlerts(l.household.id, since)).filter(
    (a) => !a.acknowledgedAt && (!input.incidentKey || a.incidentKey === input.incidentKey),
  );
  if (open.length === 0) {
    return { speech: `There are no open alerts for ${l.elder.name} right now.`, data: { acknowledged: 0 } };
  }
  for (const a of open) await deps.store.acknowledgeAlert(l.household.id, a.incidentKey, l.now.toISOString());
  const note = input.note?.trim();
  await deps.store.putMessage({
    id: `ack:${l.now.toISOString()}:${l.me.id}`,
    householdId: l.household.id,
    kind: "reminder",
    fromMemberId: l.me.id,
    fromName: l.me.name,
    text: `${l.me.name} has seen your alert${note ? ` and says: ${note}` : " and is on it"}.`,
    createdAt: l.now.toISOString(),
  });
  await deps.store.touchActivity(l.household.id, l.now.toISOString());
  return {
    speech: `Okay. I've marked ${plural(open.length, "alert")} as handled, and I'll let ${l.elder.name} know you've seen it.`,
    data: { acknowledged: open.length, kinds: open.map((a) => a.kind), elderNotified: true },
  };
}

export interface ScheduleInput {
  action: "add" | "change" | "remove";
  medication: string;
  dose?: string | undefined;
  times?: string[] | undefined;
  purpose?: string | undefined;
  confirm?: boolean | undefined;
}

export async function updateMedicationSchedule(deps: Deps, ctx: AuthContext, input: ScheduleInput): Promise<Outcome> {
  const l = await load(deps, ctx);
  requireRole(l, "caregiver");
  const meds = await deps.store.listMedications(l.household.id);
  const existing = meds.filter((m) => m.active && medicationMatches(m, input.medication));
  const times = input.times ? [...new Set(input.times)].sort() : undefined;
  if (times && !times.every(isHHMM)) throw new SpokenError("I didn't catch the time. Please say a time like 8 AM or 8:30 PM.");

  let preview: string;
  let apply: () => Promise<Medication | undefined>;

  if (input.action === "add") {
    if (!input.dose || !times?.length) {
      throw new SpokenError(`To add ${input.medication}, I need the dose and the time, for example 500 milligrams at 8 PM.`, "missing_arguments");
    }
    if (existing.length) {
      throw new SpokenError(`${existing[0]!.name} is already on ${l.elder.name}'s schedule. You can ask me to change its time or dose instead.`, "conflict");
    }
    const med: Medication = {
      id: `med-${randomUUID().slice(0, 8)}`,
      householdId: l.household.id,
      name: input.medication.trim().replace(/^\w/, (c) => c.toUpperCase()),
      dose: input.dose,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      times,
      active: true,
      createdAt: l.now.toISOString(),
    };
    preview = `add ${med.name} ${med.dose} at ${spokenList(times.map(spokenTime))} for ${l.elder.name}`;
    apply = async () => (await deps.store.putMedication(med), med);
  } else {
    if (existing.length === 0) {
      throw new SpokenError(`I couldn't find ${input.medication} on ${l.elder.name}'s schedule.`, "not_found");
    }
    const med = existing[0]!;
    if (input.action === "remove") {
      preview = `remove ${med.name} ${med.dose} from ${l.elder.name}'s schedule`;
      apply = async () => {
        const updated = { ...med, active: false };
        await deps.store.putMedication(updated);
        return updated;
      };
    } else {
      if (!input.dose && !times?.length) {
        throw new SpokenError(`What should change for ${med.name}: the time or the dose?`, "missing_arguments");
      }
      const updated: Medication = { ...med, ...(input.dose ? { dose: input.dose } : {}), ...(times?.length ? { times } : {}) };
      preview = `change ${med.name} to ${updated.dose} at ${spokenList(updated.times.map(spokenTime))}`;
      apply = async () => (await deps.store.putMedication(updated), updated);
    }
  }

  if (!input.confirm) {
    return {
      speech: `Just to confirm: ${preview}. Should I go ahead?`,
      data: { needsConfirmation: true, action: input.action, summary: preview },
    };
  }
  const result = await apply();
  await deps.store.touchActivity(l.household.id, l.now.toISOString());
  deps.digest.request(l.household.id);
  return {
    speech: `Done. I've ${preview.replace(/^add/, "added").replace(/^remove/, "removed").replace(/^change/, "changed")}. ${l.elder.name} will hear about it in the next daily plan.`,
    data: {
      needsConfirmation: false,
      applied: true,
      action: input.action,
      medication: result ? { name: result.name, dose: result.dose, times: result.times, active: result.active } : null,
    },
  };
}
