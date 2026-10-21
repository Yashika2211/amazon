/** All thresholds the rules engine uses, in one place so they are easy to audit. */
export const RULES = {
  /** A dose can be logged this many minutes before its scheduled time. */
  EARLY_LOG_WINDOW_MIN: 60,
  /** Minutes after the scheduled time with no log before a gentle reminder is queued for the elder. */
  REMINDER_AFTER_MIN: 60,
  /** Minutes after the scheduled time with no log before the family is alerted. */
  FAMILY_ALERT_AFTER_MIN: 120,
  /** Mood at or below this value counts as a low-mood day. */
  LOW_MOOD_MAX: 2,
  /** Consecutive low-mood days that trigger a "consider calling" nudge. */
  LOW_MOOD_STREAK_DAYS: 3,
  /** A repeat red-flag report with the same flags inside this window joins the existing incident. */
  RED_FLAG_DEDUPE_MIN: 30,
  /** Repeated callback requests inside this window are one incident. */
  CALLBACK_DEDUPE_MIN: 15,
} as const;
