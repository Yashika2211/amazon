export type Role = "elder" | "caregiver";

export interface Household {
  id: string;
  name: string;
  /** IANA time zone of the elder's home, e.g. "Asia/Kolkata". */
  timezone: string;
  elderMemberId: string;
  /** Local "HH:MM" by which a daily check-in is expected. */
  checkInDeadline: string;
  /** Spoken in red-flag responses, e.g. "112" (India) or "911" (US). */
  emergencyNumber: string;
  createdAt: string;
}

export interface Member {
  id: string;
  householdId: string;
  role: Role;
  name: string;
  /** How the elder refers to this person, e.g. "son", "daughter". */
  relation?: string;
  email?: string;
  phone?: string;
  telegramChatId?: string;
}

export interface Medication {
  id: string;
  householdId: string;
  name: string;
  dose: string;
  /** Plain-language purpose, used for matching phrases like "my blood pressure pill". */
  purpose?: string;
  /** Local "HH:MM" times, sorted. */
  times: string[];
  active: boolean;
  createdAt: string;
}

export interface DoseLog {
  householdId: string;
  /** Local date "YYYY-MM-DD" of the scheduled slot. */
  date: string;
  medicationId: string;
  /** The scheduled "HH:MM" this log satisfies. */
  slot: string;
  takenAt: string;
  loggedBy: string;
}

export type SleepQuality = "good" | "okay" | "poor";

export interface CheckIn {
  householdId: string;
  date: string;
  at: string;
  /** 1 (very low) to 5 (great). */
  mood: number;
  sleep?: SleepQuality;
  note?: string;
}

export type RedFlag =
  | "chest_pain"
  | "breathlessness"
  | "fall"
  | "fainting"
  | "confusion"
  | "stroke_signs";

export interface Symptom {
  id: string;
  householdId: string;
  at: string;
  date: string;
  text: string;
  flags: RedFlag[];
}

export type MessageKind = "family" | "reminder";

export interface FamilyMessage {
  id: string;
  householdId: string;
  kind: MessageKind;
  fromMemberId?: string;
  fromName: string;
  text: string;
  createdAt: string;
  heardAt?: string;
}

export type AlertKind =
  | "red_flag"
  | "missed_dose"
  | "no_checkin"
  | "low_mood"
  | "callback_request";

export type AlertSeverity = "urgent" | "warning" | "info";

export interface Alert {
  householdId: string;
  /** Deduplication key: one alert per incident. */
  incidentKey: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** One sentence, human-readable reason. */
  reason: string;
  /** The numbers behind the alert. */
  details: Record<string, string | number>;
  createdAt: string;
  acknowledgedAt?: string;
}

export interface Digest {
  householdId: string;
  date: string;
  text: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  generatedAt: string;
}
