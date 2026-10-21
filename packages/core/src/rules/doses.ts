import type { Alert, DoseLog, Medication } from "../types.js";
import { parseHHMM } from "../time.js";
import { spokenTime } from "../spoken.js";
import { RULES } from "./config.js";

export type DoseStatus = "taken" | "upcoming" | "due" | "late" | "missed";

export interface DoseSlot {
  medicationId: string;
  name: string;
  dose: string;
  purpose?: string;
  slot: string;
  status: DoseStatus;
  takenAt?: string;
}

function logKey(medicationId: string, slot: string): string {
  return `${medicationId}@${slot}`;
}

/** Status of every scheduled dose on one day. For past days pass nowMinutes = 1440. */
export function doseSlotsForDay(
  meds: Medication[],
  logs: DoseLog[],
  nowMinutes: number,
): DoseSlot[] {
  const taken = new Map(logs.map((l) => [logKey(l.medicationId, l.slot), l]));
  const slots: DoseSlot[] = [];
  for (const med of meds) {
    if (!med.active) continue;
    for (const slot of med.times) {
      const log = taken.get(logKey(med.id, slot));
      const delta = nowMinutes - parseHHMM(slot);
      let status: DoseStatus;
      if (log) status = "taken";
      else if (delta < 0) status = "upcoming";
      else if (delta < RULES.REMINDER_AFTER_MIN) status = "due";
      else if (delta < RULES.FAMILY_ALERT_AFTER_MIN) status = "late";
      else status = "missed";
      slots.push({
        medicationId: med.id,
        name: med.name,
        dose: med.dose,
        ...(med.purpose ? { purpose: med.purpose } : {}),
        slot,
        status,
        ...(log ? { takenAt: log.takenAt } : {}),
      });
    }
  }
  return slots.sort((a, b) => parseHHMM(a.slot) - parseHHMM(b.slot) || a.name.localeCompare(b.name));
}

const GENERIC_WORDS = new Set([
  "my", "the", "a", "an", "pill", "pills", "tablet", "tablets", "medicine", "medicines",
  "medication", "dose", "capsule", "i", "took", "just", "have", "taken", "for", "of",
  "morning", "evening", "night", "afternoon", "mg",
]);

const SYNONYMS: Record<string, string> = {
  bp: "blood pressure",
  pressure: "blood pressure",
  sugar: "diabetes",
  diabetic: "diabetes",
  thyroid: "thyroid",
  heart: "heart",
  cholesterol: "cholesterol",
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !GENERIC_WORDS.has(t) && !/^\d+$/.test(t));
}

/** True if a spoken phrase like "blood pressure pill" or "metformin" refers to this medication. */
export function medicationMatches(med: Medication, query: string): boolean {
  const q = tokens(query);
  if (q.length === 0) return false;
  const name = med.name.toLowerCase();
  const purpose = (med.purpose ?? "").toLowerCase();
  return q.some((t) => {
    if (name.includes(t) || (t.length >= 4 && t.startsWith(name.slice(0, 4)))) return true;
    const expanded = SYNONYMS[t] ?? t;
    return purpose.length > 0 && purpose.includes(expanded);
  });
}

export type DoseMatch =
  | { kind: "match"; medication: Medication; slot: string; minutesFromSchedule: number }
  | { kind: "already_logged"; medication: Medication; slot: string; takenAt: string }
  | { kind: "ambiguous"; options: Array<{ medication: Medication; slot: string }> }
  | { kind: "not_due"; medication: Medication; nextSlot: string }
  | { kind: "unknown_medication" }
  | { kind: "no_medications" };

/**
 * Decides which scheduled dose a spoken "I took my pill" refers to.
 * Picks the untaken slot closest to now among slots that are due (or within the early window).
 * Re-logging an already-taken slot is reported as already_logged, which keeps logging idempotent.
 */
export function matchDose(
  meds: Medication[],
  todaysLogs: DoseLog[],
  nowMinutes: number,
  query?: string,
): DoseMatch {
  const active = meds.filter((m) => m.active && m.times.length > 0);
  if (active.length === 0) return { kind: "no_medications" };
  const candidates = query && tokens(query).length > 0 ? active.filter((m) => medicationMatches(m, query)) : active;
  if (candidates.length === 0) return { kind: "unknown_medication" };

  const taken = new Map(todaysLogs.map((l) => [logKey(l.medicationId, l.slot), l]));
  const open: Array<{ medication: Medication; slot: string; distance: number }> = [];
  const done: Array<{ medication: Medication; slot: string; log: DoseLog }> = [];
  for (const med of candidates) {
    for (const slot of med.times) {
      const slotMin = parseHHMM(slot);
      if (slotMin - RULES.EARLY_LOG_WINDOW_MIN > nowMinutes) continue;
      const log = taken.get(logKey(med.id, slot));
      if (log) done.push({ medication: med, slot, log });
      else open.push({ medication: med, slot, distance: Math.abs(nowMinutes - slotMin) });
    }
  }

  if (open.length > 0) {
    open.sort((a, b) => a.distance - b.distance);
    const best = open[0]!;
    const tied = open.filter((o) => o.distance === best.distance && o.medication.id !== best.medication.id);
    if (tied.length > 0) {
      return {
        kind: "ambiguous",
        options: [best, ...tied].map(({ medication, slot }) => ({ medication, slot })),
      };
    }
    return {
      kind: "match",
      medication: best.medication,
      slot: best.slot,
      minutesFromSchedule: nowMinutes - parseHHMM(best.slot),
    };
  }

  if (done.length > 0) {
    done.sort((a, b) => parseHHMM(b.slot) - parseHHMM(a.slot));
    const last = done[0]!;
    return { kind: "already_logged", medication: last.medication, slot: last.slot, takenAt: last.log.takenAt };
  }

  const upcoming = candidates
    .flatMap((m) => m.times.map((slot) => ({ medication: m, slot })))
    .sort((a, b) => parseHHMM(a.slot) - parseHHMM(b.slot))[0]!;
  return { kind: "not_due", medication: upcoming.medication, nextSlot: upcoming.slot };
}

export interface ReminderAction {
  incidentKey: string;
  text: string;
}

export interface DoseEscalation {
  reminders: ReminderAction[];
  alerts: Array<Omit<Alert, "householdId" | "createdAt">>;
}

/** Missed-dose rule: reminder to the elder at +60 min, family alert at +120 min. */
export function evaluateDoses(
  meds: Medication[],
  todaysLogs: DoseLog[],
  date: string,
  nowMinutes: number,
  elderName: string,
): DoseEscalation {
  const slots = doseSlotsForDay(meds, todaysLogs, nowMinutes);
  const takenCount = slots.filter((s) => s.status === "taken").length;
  const scheduledSoFar = slots.filter((s) => s.status !== "upcoming").length;
  const out: DoseEscalation = { reminders: [], alerts: [] };
  for (const s of slots) {
    if (s.status !== "late" && s.status !== "missed") continue;
    const minutesLate = nowMinutes - parseHHMM(s.slot);
    out.reminders.push({
      incidentKey: `reminder:${date}:${s.medicationId}:${s.slot}`,
      text: `A gentle reminder: your ${s.name} ${s.dose} was due at ${spokenTime(s.slot)}. If you've already taken it, just tell me.`,
    });
    if (s.status === "missed") {
      out.alerts.push({
        incidentKey: `missed_dose:${date}:${s.medicationId}:${s.slot}`,
        kind: "missed_dose",
        severity: "warning",
        reason: `${elderName} hasn't logged ${s.name} ${s.dose}, due at ${spokenTime(s.slot)}, ${minutesLate} minutes ago.`,
        details: {
          medication: `${s.name} ${s.dose}`,
          scheduledAt: s.slot,
          minutesLate,
          dosesTakenToday: takenCount,
          dosesDueSoFar: scheduledSoFar,
        },
      });
    }
  }
  return out;
}
