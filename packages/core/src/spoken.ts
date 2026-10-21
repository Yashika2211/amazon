import { parseHHMM } from "./time.js";

/** "08:00" → "8 AM", "20:30" → "8:30 PM", "00:00" → "12 AM", "12:15" → "12:15 PM". */
export function spokenTime(hhmm: string): string {
  const minutes = parseHHMM(hhmm);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** ["a"] → "a"; ["a","b"] → "a and b"; ["a","b","c"] → "a, b, and c". */
export function spokenList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** 1 → "1 dose", 2 → "2 doses". */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

/** Strips characters that read badly aloud (markdown, bullets, extra whitespace). */
export function speakable(text: string): string {
  return text
    .replace(/[*_#`>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
