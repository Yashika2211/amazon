import type { Alert, RedFlag, Symptom } from "../types.js";
import { RULES } from "./config.js";

/**
 * Deterministic red-flag phrases. These are deliberately broad: a false alarm costs a phone call,
 * a miss can cost far more. No LLM is involved in this decision.
 */
// English, romanized Hindi (Hinglish) and Devanagari: Chrome's hi-IN speech recognition returns
// Devanagari, while people typing or code-mixing tend to use romanized Hindi.
const PATTERNS: Record<RedFlag, RegExp[]> = {
  chest_pain: [
    /chest (pain|hurts?|tight(ness)?|pressure|heavy|heaviness)/,
    /(pain|tightness|pressure|heaviness) in (my )?chest/,
    /heart attack/,
    /(seene|seeney|sine|chhati|chati|chhaati) (mein|me|main) (dard|bhaaripan|jalan|dabav)/,
    /(सीने|छाती) (में|मे) (दर्द|भारीपन|दबाव)/,
    /dil ka daura/,
    /दिल का दौरा/,
  ],
  breathlessness: [
    /(can'?t|cannot|can not|unable to) breathe/,
    /short(ness)? of breath/,
    /breathless/,
    /(trouble|difficulty|hard|struggling) (to )?breath(e|ing)/,
    /gasping/,
    /saa?ns (nahi|nahin|nai) (aa|le paa?)/,
    /saa?ns (phool|ukhad|lene mein (dikkat|takleef|pareshani))/,
    /(सांस|साँस) (नहीं|फूल|उखड़|लेने में)/,
  ],
  fall: [
    /\bi (fell|have fallen|had a fall|took a fall)\b(?! asleep)/,
    /\b(fell|fallen) (down|over|in the|on the|off)/,
    /\bhad a fall\b/,
    /\bslipped\b/,
    /\bgir (gayi|gaya|gai|gaye|padi|pada|padaa)\b/,
    /\bfisal (gayi|gaya|gai)\b/,
    /(गिर|फिसल) (गई|गया|गयी|पड़ी|पड़ा)/,
  ],
  fainting: [
    /faint(ed|ing)?\b/,
    /passed out/,
    /blacked out/,
    /lost consciousness/,
    /\bcollapsed?\b/,
    /\bbehosh/,
    /\bbehoshi/,
    /aankhon (ke aage|ke saamne) andhera/,
    /बेहोश/,
    /आंखों के (आगे|सामने) अंधेरा/,
  ],
  confusion: [
    /\bconfus(ed|ion)\b/,
    /disoriented/,
    /(don'?t|do not) know where i am/,
    /can'?t remember where i am/,
    /(pata|maloom) nahi?n? (main|mai|mein) kaha?n (hoon|hu)/,
    /kuch samajh nahi?n? aa raha/,
    /(समझ नहीं आ रहा|पता नहीं मैं कहाँ)/,
  ],
  stroke_signs: [
    /\bstroke\b/,
    /(face|mouth) (is )?droop(ing|y)?/,
    /slurr(ed|ing)/,
    /(numb|weak)(ness)? (on|in) (one|my (left|right)) side/,
    /(can'?t|cannot) (lift|move) my (arm|leg)/,
    /(trouble|difficulty) (speaking|talking)/,
    /\blakwa\b/,
    /(muh|munh|muhn) (tedha|tedhaa|latak)/,
    /(zubaan|zuban|jeebh) (lad|ladkhada|atak)/,
    /ek (taraf|side) (sunn|kamzori|sun pad)/,
    /(लकवा|मुंह टेढ़ा|जुबान लड़खड़ा|एक तरफ सुन्न)/,
  ],
};

/** Negation before the phrase (English: "no chest pain"). */
const NEGATIONS = /\b(no|not|never|without|don'?t have|didn'?t|no more)\b/;
/** Negation right after the phrase (Hindi: "seene mein dard nahi hai", "सीने में दर्द नहीं"). */
const TRAILING_NEGATION = /^\s*(nahi|nahin|nai|नहीं)(?![a-z])/;

/** Returns the red flags present in free text. A match preceded closely by a negation is ignored. */
export function classifySymptom(text: string): RedFlag[] {
  const normalized = ` ${text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ")} `;
  const found: RedFlag[] = [];
  for (const [flag, patterns] of Object.entries(PATTERNS) as Array<[RedFlag, RegExp[]]>) {
    for (const p of patterns) {
      const m = p.exec(normalized);
      if (!m) continue;
      const before = normalized.slice(Math.max(0, m.index - 20), m.index);
      const after = normalized.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if (NEGATIONS.test(before) || TRAILING_NEGATION.test(after)) continue;
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
