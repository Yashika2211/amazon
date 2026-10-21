import { randomUUID } from "node:crypto";
import { addDays, isHHMM, lastNDates, localParts, type Household, type Member } from "@kinloop/core";
import { hashPin } from "../oauth/crypto.js";
import type { Deps } from "./deps.js";
import { getParentStatus, SpokenError, type AuthContext } from "./kinloop.js";

export interface TimelineEvent {
  at: string;
  kind: "dose" | "checkin" | "symptom" | "message" | "alert";
  title: string;
  detail?: string;
  tone: "ok" | "info" | "warn" | "urgent";
}

/** Everything the caregiver dashboard shows, in one read. */
export async function dashboardData(deps: Deps, ctx: AuthContext) {
  const status = await getParentStatus(deps, ctx);
  const household = (await deps.store.getHousehold(ctx.householdId))!;
  const { date } = localParts(deps.clock.now(), household.timezone);
  const since = addDays(date, -6);
  const [meds, logs, checkIns, symptoms, messages, alerts, members] = await Promise.all([
    deps.store.listMedications(ctx.householdId),
    deps.store.listDoseLogs(ctx.householdId, date, date),
    deps.store.listCheckIns(ctx.householdId, since),
    deps.store.listSymptoms(ctx.householdId, date),
    deps.store.listMessages(ctx.householdId),
    deps.store.listAlerts(ctx.householdId, new Date(Date.now() - 7 * 86400000).toISOString()),
    deps.store.listMembers(ctx.householdId),
  ]);
  const medName = new Map(meds.map((m) => [m.id, `${m.name} ${m.dose}`]));
  const isToday = (iso: string) => localParts(new Date(iso), household.timezone).date === date;

  const timeline: TimelineEvent[] = [
    ...logs.map((l) => ({ at: l.takenAt, kind: "dose" as const, title: `Took ${medName.get(l.medicationId) ?? "a medicine"}`, detail: `Scheduled ${l.slot}`, tone: "ok" as const })),
    ...checkIns.filter((c) => c.date === date).map((c) => ({
      at: c.at,
      kind: "checkin" as const,
      title: `Checked in: mood ${c.mood}/5${c.sleep ? `, ${c.sleep} sleep` : ""}`,
      ...(c.note ? { detail: c.note } : {}),
      tone: c.mood <= 2 ? ("warn" as const) : ("ok" as const),
    })),
    ...symptoms.map((s) => ({
      at: s.at,
      kind: "symptom" as const,
      title: s.flags.length ? "Red-flag symptom reported" : "Symptom noted",
      detail: s.text,
      tone: s.flags.length ? ("urgent" as const) : ("info" as const),
    })),
    ...messages.filter((m) => m.kind === "family" && isToday(m.createdAt)).map((m) => ({
      at: m.createdAt,
      kind: "message" as const,
      title: `Message from ${m.fromName}${m.heardAt ? " (heard)" : ""}`,
      detail: m.text,
      tone: "info" as const,
    })),
    ...alerts.filter((a) => isToday(a.createdAt)).map((a) => ({
      at: a.createdAt,
      kind: "alert" as const,
      title: a.reason,
      tone: a.severity === "urgent" ? ("urgent" as const) : a.severity === "warning" ? ("warn" as const) : ("info" as const),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const moodByDate = new Map(checkIns.map((c) => [c.date, c.mood]));
  return {
    ...status.data,
    speech: status.speech,
    household: { name: household.name, timezone: household.timezone, emergencyNumber: household.emergencyNumber, checkInDeadline: household.checkInDeadline },
    me: members.find((m) => m.id === ctx.memberId),
    medications: meds.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, dose: m.dose, purpose: m.purpose ?? null, times: m.times })),
    timeline,
    mood7d: lastNDates(date, 7).map((d) => ({ date: d, mood: moodByDate.get(d) ?? null })),
    alerts: alerts.map((a) => ({ incidentKey: a.incidentKey, kind: a.kind, severity: a.severity, reason: a.reason, details: a.details, at: a.createdAt, acknowledged: Boolean(a.acknowledgedAt) })),
    messages: messages.filter((m) => m.kind === "family").slice(-10).reverse().map((m) => ({ id: m.id, from: m.fromName, text: m.text, at: m.createdAt, heard: Boolean(m.heardAt) })),
  };
}

export interface SetupInput {
  householdName: string;
  timezone: string;
  emergencyNumber: string;
  checkInDeadline: string;
  elderName: string;
  elderUsername: string;
  elderPin: string;
  caregiverName: string;
  caregiverRelation?: string | undefined;
  caregiverUsername: string;
  caregiverPin: string;
  caregiverEmail?: string | undefined;
}

/** Creates a household with one elder and one caregiver login. */
export async function createHousehold(deps: Deps, input: SetupInput): Promise<{ householdId: string }> {
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new SpokenError("That time zone isn't recognised.");
  }
  if (!isHHMM(input.checkInDeadline)) throw new SpokenError("The check-in time must look like 11:00.");
  if (input.elderUsername.toLowerCase() === input.caregiverUsername.toLowerCase()) {
    throw new SpokenError("The parent and the family member need different sign-in names.");
  }
  const householdId = `hh-${randomUUID().slice(0, 12)}`;
  const elder: Member = { id: `m-${randomUUID().slice(0, 8)}`, householdId, role: "elder", name: input.elderName };
  const caregiver: Member = {
    id: `m-${randomUUID().slice(0, 8)}`,
    householdId,
    role: "caregiver",
    name: input.caregiverName,
    ...(input.caregiverRelation ? { relation: input.caregiverRelation } : {}),
    ...(input.caregiverEmail ? { email: input.caregiverEmail } : {}),
  };
  // Claim both usernames first so a taken name fails before anything else is written.
  const okElder = await deps.store.putCredential({ username: input.elderUsername, householdId, memberId: elder.id, pinHash: hashPin(input.elderPin) });
  if (!okElder) throw new SpokenError(`The name ${input.elderUsername} is already taken.`, "conflict");
  const okCare = await deps.store.putCredential({ username: input.caregiverUsername, householdId, memberId: caregiver.id, pinHash: hashPin(input.caregiverPin) });
  if (!okCare) throw new SpokenError(`The name ${input.caregiverUsername} is already taken.`, "conflict");
  const household: Household = {
    id: householdId,
    name: input.householdName,
    timezone: input.timezone,
    elderMemberId: elder.id,
    checkInDeadline: input.checkInDeadline,
    emergencyNumber: input.emergencyNumber,
    createdAt: new Date().toISOString(),
  };
  await deps.store.putHousehold(household);
  await deps.store.putMember(elder);
  await deps.store.putMember(caregiver);
  return { householdId };
}
