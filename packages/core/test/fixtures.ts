import type { CheckIn, DoseLog, Household, Medication } from "../src/types.js";

export const household: Household = {
  id: "hh1",
  name: "Test household",
  timezone: "Asia/Kolkata",
  elderMemberId: "m-elder",
  checkInDeadline: "11:00",
  emergencyNumber: "112",
  createdAt: "2026-10-01T00:00:00.000Z",
};

export function med(id: string, name: string, times: string[], extra: Partial<Medication> = {}): Medication {
  return {
    id,
    householdId: "hh1",
    name,
    dose: "5mg",
    times,
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

export function log(medicationId: string, slot: string, date = "2026-10-21"): DoseLog {
  return {
    householdId: "hh1",
    date,
    medicationId,
    slot,
    takenAt: `${date}T03:00:00.000Z`,
    loggedBy: "m-elder",
  };
}

export function checkIn(date: string, mood: number): CheckIn {
  return { householdId: "hh1", date, at: `${date}T03:00:00.000Z`, mood };
}

/** Builds a Date that is the given local IST time on 2026-10-21. */
export function ist(hhmm: string, date = "2026-10-21"): Date {
  return new Date(`${date}T${hhmm}:00+05:30`);
}
