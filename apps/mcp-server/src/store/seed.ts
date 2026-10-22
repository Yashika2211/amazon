import {
  addDays,
  doseSlotsForDay,
  localParts,
  type CheckIn,
  type Household,
  type Medication,
  type Member,
  type SleepQuality,
} from "@kinloop/core";
import { hashPin } from "../oauth/crypto.js";
import type { Store } from "./store.js";
import type { Table } from "./table.js";

/** Fictional demo household. Every name, number and record here is made up. */
export const DEMO = {
  householdId: "hh-demo",
  elderId: "m-kamala",
  caregiverId: "m-arjun",
  elderUsername: "kamala",
  caregiverUsername: "arjun",
  elderPin: "1111",
  caregiverPin: "2222",
} as const;

export interface SeedOptions {
  now: Date;
  caregiverEmail?: string;
  caregiverPhone?: string;
  caregiverTelegramChatId?: string;
}

/** A small deterministic PRNG so the seeded week looks the same on every run. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Removes every item belonging to the demo household so a reseed starts clean. */
export async function wipeDemo(table: Table): Promise<void> {
  const items = await table.query(`HH#${DEMO.householdId}`, "");
  await Promise.all(items.map((i) => table.delete(i.pk, i.sk)));
}

export async function seedDemo(store: Store, opts: SeedOptions): Promise<void> {
  const tz = "Asia/Kolkata";
  const createdAt = addDays(localParts(opts.now, tz).date, -10) + "T00:00:00.000Z";
  const today = localParts(opts.now, tz).date;
  const household: Household = {
    id: DEMO.householdId,
    name: "Kamala's home, Jaipur",
    timezone: tz,
    elderMemberId: DEMO.elderId,
    checkInDeadline: "11:00",
    emergencyNumber: "112",
    createdAt,
  };
  const elder: Member = { id: DEMO.elderId, householdId: household.id, role: "elder", name: "Kamala" };
  const caregiver: Member = {
    id: DEMO.caregiverId,
    householdId: household.id,
    role: "caregiver",
    name: "Arjun",
    relation: "son",
    ...(opts.caregiverEmail ? { email: opts.caregiverEmail } : {}),
    ...(opts.caregiverPhone ? { phone: opts.caregiverPhone } : {}),
    ...(opts.caregiverTelegramChatId ? { telegramChatId: opts.caregiverTelegramChatId } : {}),
  };
  const meds: Medication[] = [
    { id: "med-amlodipine", householdId: household.id, name: "Amlodipine", dose: "5 mg", purpose: "blood pressure", times: ["08:00"], active: true, createdAt, pillsLeft: 24, refilledAt: createdAt },
    { id: "med-metformin", householdId: household.id, name: "Metformin", dose: "500 mg", purpose: "diabetes", times: ["08:00", "20:00"], active: true, createdAt, pillsLeft: 9, refilledAt: createdAt },
    { id: "med-atorvastatin", householdId: household.id, name: "Atorvastatin", dose: "10 mg", purpose: "cholesterol", times: ["21:00"], active: true, createdAt },
  ];

  await store.putHousehold(household);
  await store.putMember(elder);
  await store.putMember(caregiver);
  for (const m of meds) await store.putMedication(m);
  await store.putCredential({ username: DEMO.elderUsername, householdId: household.id, memberId: elder.id, pinHash: hashPin(DEMO.elderPin) });
  await store.putCredential({ username: DEMO.caregiverUsername, householdId: household.id, memberId: caregiver.id, pinHash: hashPin(DEMO.caregiverPin) });

  // Seven days of history before today. Mood dips mid-week, one evening dose missed twice.
  const rand = prng(72);
  const moods = [4, 4, 3, 2, 3, 4, 4];
  const sleeps: SleepQuality[] = ["good", "okay", "poor", "poor", "okay", "good", "okay"];
  const notes = ["Walked to the temple.", "", "Knees ached in the evening.", "Missed the kids.", "", "Neighbour visited.", "Watched a film with Sunita."];
  for (let i = 7; i >= 1; i--) {
    const date = addDays(today, -i);
    const idx = 7 - i;
    for (const slot of doseSlotsForDay(meds, [], 1440)) {
      const skip = (slot.slot === "21:00" && (idx === 2 || idx === 3)) || (slot.slot === "20:00" && idx === 3);
      if (skip) continue;
      const lateBy = Math.floor(rand() * 35);
      const [h, m] = slot.slot.split(":").map(Number) as [number, number];
      const takenLocal = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
      takenLocal.setMinutes(takenLocal.getMinutes() + lateBy);
      await store.putDoseLogIfAbsent({
        householdId: household.id,
        date,
        medicationId: slot.medicationId,
        slot: slot.slot,
        takenAt: takenLocal.toISOString(),
        loggedBy: elder.id,
      });
    }
    const checkIn: CheckIn = {
      householdId: household.id,
      date,
      at: new Date(`${date}T09:${String(10 + Math.floor(rand() * 40)).padStart(2, "0")}:00+05:30`).toISOString(),
      mood: moods[idx]!,
      sleep: sleeps[idx]!,
      ...(notes[idx] ? { note: notes[idx] } : {}),
    };
    await store.putCheckIn(checkIn);
  }

  const threeDaysAgo = addDays(today, -4);
  await store.putSymptom({
    id: "sym-seed-1",
    householdId: household.id,
    at: new Date(`${threeDaysAgo}T18:30:00+05:30`).toISOString(),
    date: threeDaysAgo,
    text: "my knees ache in the evening",
    flags: [],
  });
  await store.putAlertIfAbsent({
    householdId: household.id,
    incidentKey: `missed_dose:${threeDaysAgo}:med-atorvastatin:21:00`,
    kind: "missed_dose",
    severity: "warning",
    reason: "Kamala hasn't logged Atorvastatin 10 mg, due at 9 PM, 120 minutes ago.",
    details: { medication: "Atorvastatin 10 mg", scheduledAt: "21:00", minutesLate: 120, dosesTakenToday: 2, dosesDueSoFar: 4 },
    createdAt: new Date(`${threeDaysAgo}T23:00:00+05:30`).toISOString(),
    acknowledgedAt: new Date(`${threeDaysAgo}T23:12:00+05:30`).toISOString(),
  });
  await store.putMessage({
    id: "msg-seed-1",
    householdId: household.id,
    kind: "family",
    fromMemberId: caregiver.id,
    fromName: "Arjun",
    text: "Good morning Ma! Priya says hello. I'll call you tonight after dinner.",
    createdAt: new Date(opts.now.getTime() - 50 * 60000).toISOString(),
  });
  await store.putAppointment({
    id: "appt-seed-1",
    householdId: household.id,
    date: today,
    time: "16:30",
    title: "an eye check-up with Dr. Mehta",
  });
  const yesterday = addDays(today, -1);
  await store.putDigest({
    householdId: household.id,
    date: yesterday,
    text: "Kamala took all four of her doses yesterday and checked in after breakfast with a mood of 4 out of 5. She mentioned watching a film with Sunita. No symptoms or alerts were logged.",
    modelId: "seed",
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    generatedAt: new Date(`${yesterday}T21:30:00+05:30`).toISOString(),
  });
}
