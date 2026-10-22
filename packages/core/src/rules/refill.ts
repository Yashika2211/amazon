import type { Alert, Medication } from "../types.js";
import { RULES } from "./config.js";

export interface RefillStatus {
  medicationId: string;
  name: string;
  dose: string;
  pillsLeft: number;
  dosesPerDay: number;
  /** Whole days of supply left at the current schedule. */
  daysLeft: number;
  needsRefill: boolean;
}

/** Supply left for one medicine, or null when its supply isn't tracked. */
export function refillStatus(med: Medication): RefillStatus | null {
  if (!med.active || med.pillsLeft === undefined || med.times.length === 0) return null;
  const dosesPerDay = med.times.length;
  const daysLeft = Math.floor(Math.max(0, med.pillsLeft) / dosesPerDay);
  return {
    medicationId: med.id,
    name: med.name,
    dose: med.dose,
    pillsLeft: Math.max(0, med.pillsLeft),
    dosesPerDay,
    daysLeft,
    needsRefill: daysLeft <= RULES.REFILL_WARN_DAYS,
  };
}

/** One family alert per medicine per supply when it is running low. */
export function evaluateRefills(meds: Medication[], elderName: string): Array<Omit<Alert, "householdId" | "createdAt">> {
  const out: Array<Omit<Alert, "householdId" | "createdAt">> = [];
  for (const med of meds) {
    const r = refillStatus(med);
    if (!r?.needsRefill) continue;
    const when = r.daysLeft === 0 ? "has run out" : `runs out in about ${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"}`;
    out.push({
      incidentKey: `refill:${med.id}:${med.refilledAt ?? med.createdAt}`,
      kind: "refill_due",
      severity: r.daysLeft <= 1 ? "warning" : "info",
      reason: `${elderName}'s ${med.name} ${med.dose} ${when}. Time to order a refill.`,
      details: { medication: `${med.name} ${med.dose}`, pillsLeft: r.pillsLeft, dosesPerDay: r.dosesPerDay, daysLeft: r.daysLeft },
    });
  }
  return out;
}
