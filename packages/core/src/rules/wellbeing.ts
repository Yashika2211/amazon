import type { Alert, CheckIn } from "../types.js";
import { addDays, parseHHMM } from "../time.js";
import { spokenTime } from "../spoken.js";
import { RULES } from "./config.js";

type PendingAlert = Omit<Alert, "householdId" | "createdAt">;

/** No check-in by the household's deadline (default 11:00 local) → family alert. */
export function evaluateCheckIn(
  todaysCheckIn: CheckIn | undefined,
  date: string,
  nowMinutes: number,
  deadline: string,
  elderName: string,
  lastCheckInDate?: string,
): PendingAlert | null {
  if (todaysCheckIn) return null;
  if (nowMinutes < parseHHMM(deadline)) return null;
  return {
    incidentKey: `no_checkin:${date}`,
    kind: "no_checkin",
    severity: "warning",
    reason: `${elderName} hasn't checked in today. The usual check-in time is ${spokenTime(deadline)}.`,
    details: { deadline, lastCheckIn: lastCheckInDate ?? "none" },
  };
}

/** Number of consecutive low-mood days ending today (or yesterday, if today has no check-in yet). */
export function lowMoodStreak(checkIns: CheckIn[], today: string): { days: number; start: string; moods: number[] } {
  const byDate = new Map(checkIns.map((c) => [c.date, c.mood]));
  let cursor = byDate.has(today) ? today : addDays(today, -1);
  const moods: number[] = [];
  let start = cursor;
  while (true) {
    const mood = byDate.get(cursor);
    if (mood === undefined || mood > RULES.LOW_MOOD_MAX) break;
    moods.unshift(mood);
    start = cursor;
    cursor = addDays(cursor, -1);
  }
  return { days: moods.length, start, moods };
}

/** Three or more low-mood days in a row → a gentle "consider calling" nudge, once per streak. */
export function evaluateLowMood(checkIns: CheckIn[], today: string, elderName: string): PendingAlert | null {
  const streak = lowMoodStreak(checkIns, today);
  if (streak.days < RULES.LOW_MOOD_STREAK_DAYS) return null;
  return {
    incidentKey: `low_mood:${streak.start}`,
    kind: "low_mood",
    severity: "info",
    reason: `${elderName} has reported low mood ${streak.days} days in a row. Consider calling for a chat.`,
    details: { days: streak.days, moods: streak.moods.join(", "), since: streak.start },
  };
}
