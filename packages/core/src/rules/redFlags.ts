import type { Alert, RedFlag, Symptom } from "../types.js";
import { RULES } from "./config.js";

/**
 * Deterministic red-flag phrases. These are deliberately broad: a false alarm costs a phone call,
 * a miss can cost far more. No LLM is involved in this decision.
 */
const PATTERNS: Record<RedFlag, RegExp[]> = {
  chest_pain: [
    /chest (pain|hurts?|tight(ness)?|pressure|heavy|heaviness)/,
    /(pain|tightness|pressure|heaviness) in (my )?chest/,
    /heart attack/,
  ],
  breathlessness: [
    /(can'?t|cannot|can not|unable to) breathe/,
    /short(ness)? of breath/,
    /breathless/,
    /(trouble|difficulty|hard|struggling) (to )?breath(e|ing)/,
    /gasping/,
  ],
  fall: [
    /\bi (fell|have fallen|had a fall|took a fall)\b(?! asleep)/,
    /\b(fell|fallen) (down|over|in the|on the|off)/,
    /\bhad a fall\b/,
    /\bslipped\b/,
  ],
  fainting: [/faint(ed|ing)?\b/, /passed out/, /blacked out/, /lost consciousness/, /\bcollapsed?\b/],
  confusion: [
    /\bconfus(ed|ion)\b/,
    /disoriented/,
    /(don'?t|do not) know where i am/,
    /can'?t remember where i am/,
  ],
  stroke_signs: [
    /\bstroke\b/,
    /(face|mouth) (is )?droop(ing|y)?/,
    /slurr(ed|ing)/,
    /(numb|weak)(ness)? (on|in) (one|my (left|right)) side/,
    /(can'?t|cannot) (lift|move) my (arm|leg)/,
    /(trouble|difficulty) (speaking|talking)/,
  ],
};

const NEGATIONS = /\b(no|not|never|without|don'?t have|didn'?t|no more)\b/;

/** Returns the red flags present in free text. A match preceded closely by a negation is ignored. */
export function classifySymptom(text: string): RedFlag[] {
  const normalized = ` ${text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ")} `;
  const found: RedFlag[] = [];
  for (const [flag, patterns] of Object.entries(PATTERNS) as Array<[RedFlag, RegExp[]]>) {
    for (const p of patterns) {
      const m = p.exec(normalized);
      if (!m) continue;
      const before = normalized.slice(Math.max(0, m.index - 20), m.index);
      if (NEGATIONS.test(before)) continue;
      found.push(flag);
      break;
    }
  }
  return found;
}

export const RED_FLAG_LABELS: Record<RedFlag, string> = {
  chest_pain: "chest pain",
  breathlessness: "trouble breathing",
  fall: "a fall",
  fainting: "fainting",
  confusion: "confusion",
  stroke_signs: "possible stroke signs",
};

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

/**
 * Builds the immediate family alert for a red-flag symptom, or null if it is not a red flag
 * or the same flags were already alerted within the dedupe window (same incident).
 */
export function redFlagAlert(
  symptom: Symptom,
  elderName: string,
  recentAlerts: Alert[],
): Alert | null {
  if (symptom.flags.length === 0) return null;
  const flagKey = [...symptom.flags].sort().join("+");
  const duplicate = recentAlerts.some(
    (a) =>
      a.kind === "red_flag" &&
      a.details.flags === flagKey &&
      minutesBetween(a.createdAt, symptom.at) <= RULES.RED_FLAG_DEDUPE_MIN,
  );
  if (duplicate) return null;
  const labels = symptom.flags.map((f) => RED_FLAG_LABELS[f]);
  return {
    householdId: symptom.householdId,
    incidentKey: `red_flag:${symptom.id}`,
    kind: "red_flag",
    severity: "urgent",
    reason: `${elderName} reported ${labels.join(" and ")}: "${symptom.text}". Please call now.`,
    details: { flags: flagKey, reportedAt: symptom.at, symptomId: symptom.id },
    createdAt: symptom.at,
  };
}

/** A "please call me" request. Repeats within the dedupe window are the same incident. */
export function callbackAlert(
  householdId: string,
  elderName: string,
  requestedOf: string,
  at: string,
  recentAlerts: Alert[],
  note?: string,
): Alert | null {
  const duplicate = recentAlerts.some(
    (a) =>
      a.kind === "callback_request" &&
      a.details.requestedOf === requestedOf &&
      minutesBetween(a.createdAt, at) <= RULES.CALLBACK_DEDUPE_MIN,
  );
  if (duplicate) return null;
  return {
    householdId,
    incidentKey: `callback:${at}:${requestedOf}`,
    kind: "callback_request",
    severity: "info",
    reason: `${elderName} asked ${requestedOf} to call.${note ? ` Note: "${note}"` : ""}`,
    details: { requestedOf, requestedAt: at },
    createdAt: at,
  };
}
