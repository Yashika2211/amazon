import type { Alert, CheckIn, DoseLog, Household, Medication } from "../types.js";
import { localParts } from "../time.js";
import { evaluateDoses, type ReminderAction } from "./doses.js";
import { evaluateCheckIn, evaluateLowMood } from "./wellbeing.js";

export interface EscalationInput {
  household: Household;
  elderName: string;
  medications: Medication[];
  todaysDoseLogs: DoseLog[];
  /** Recent check-ins (at least the last week), any order. */
  checkIns: CheckIn[];
  /** Incident keys already raised (alerts and reminders), for deduplication. */
  existingIncidentKeys: Set<string>;
  now: Date;
}

export interface EscalationResult {
  alerts: Alert[];
  reminders: ReminderAction[];
}

/**
 * The scheduled escalation pass. Pure: given the household state and the clock, returns the new
 * alerts and reminders to raise. Anything whose incident key was already raised is dropped.
 */
export function runEscalation(input: EscalationInput): EscalationResult {
  const { household, elderName, now } = input;
  const { date, minutes } = localParts(now, household.timezone);
  const createdAt = now.toISOString();

  const doses = evaluateDoses(input.medications, input.todaysDoseLogs, date, minutes, elderName);
  const todays = input.checkIns.find((c) => c.date === date);
  const lastCheckIn = input.checkIns
    .map((c) => c.date)
    .sort()
    .at(-1);
  const pending = [
    ...doses.alerts,
    evaluateCheckIn(todays, date, minutes, household.checkInDeadline, elderName, lastCheckIn),
    evaluateLowMood(input.checkIns, date, elderName),
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  return {
    alerts: dedupe(pending, input.existingIncidentKeys).map((a) => ({
      ...a,
      householdId: household.id,
      createdAt,
    })),
    reminders: dedupe(doses.reminders, input.existingIncidentKeys),
  };
}

/** Drops anything whose incidentKey was already raised, and duplicates within the batch. */
export function dedupe<T extends { incidentKey: string }>(items: T[], existing: Set<string>): T[] {
  const seen = new Set(existing);
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.incidentKey)) continue;
    seen.add(item.incidentKey);
    out.push(item);
  }
  return out;
}
