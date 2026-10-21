import type { CheckIn, DoseLog, Medication } from "./types.js";
import { doseSlotsForDay, type DoseSlot } from "./rules/doses.js";
import { lastNDates } from "./time.js";

export interface DaySummary {
  taken: DoseSlot[];
  missed: DoseSlot[];
  /** Due now or late, not yet missed. */
  pending: DoseSlot[];
  upcoming: DoseSlot[];
}

export function summarizeDay(slots: DoseSlot[]): DaySummary {
  return {
    taken: slots.filter((s) => s.status === "taken"),
    missed: slots.filter((s) => s.status === "missed"),
    pending: slots.filter((s) => s.status === "due" || s.status === "late"),
    upcoming: slots.filter((s) => s.status === "upcoming"),
  };
}

export interface AdherenceDay {
  date: string;
  taken: number;
  scheduled: number;
}

/** Doses taken vs. scheduled for each of the last `days` days, oldest first. Today counts only doses already due. */
export function adherence(
  meds: Medication[],
  logs: DoseLog[],
  today: string,
  nowMinutes: number,
  days = 7,
): AdherenceDay[] {
  return lastNDates(today, days).map((date) => {
    const dayLogs = logs.filter((l) => l.date === date);
    const slots = doseSlotsForDay(meds, dayLogs, date === today ? nowMinutes : 1440).filter(
      (s) => s.status !== "upcoming",
    );
    return { date, taken: slots.filter((s) => s.status === "taken").length, scheduled: slots.length };
  });
}

export type MoodTrend = "improving" | "steady" | "declining" | "unknown";

/** Compares the average of the latest three check-ins with the three before them. */
export function moodTrend(checkIns: CheckIn[]): MoodTrend {
  const sorted = [...checkIns].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 4) return "unknown";
  const recent = sorted.slice(-3);
  const prior = sorted.slice(-6, -3);
  const avg = (xs: CheckIn[]) => xs.reduce((s, c) => s + c.mood, 0) / xs.length;
  const diff = avg(recent) - avg(prior);
  if (diff >= 0.5) return "improving";
  if (diff <= -0.5) return "declining";
  return "steady";
}
