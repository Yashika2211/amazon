import { localParts } from "@kinloop/core";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Pins the clock to `hhmm` local time today in `timeZone`, keeping real seconds ticking forward,
 * so a recorded demo always happens at the same point in Kamala's day.
 */
export function pinnedClock(hhmm: string, timeZone: string): Clock {
  const bootedAt = Date.now();
  return {
    now() {
      const { date } = localParts(new Date(), timeZone);
      const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")!
        .value.replace("GMT", "");
      const base = new Date(`${date}T${hhmm}:00${offset || "+00:00"}`).getTime();
      // Advance at real speed, but never more than 50 minutes past the pinned time.
      return new Date(base + Math.min(Date.now() - bootedAt, 50 * 60000));
    },
  };
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = d;
  }
  advanceMinutes(m: number): void {
    this.current = new Date(this.current.getTime() + m * 60000);
  }
}
