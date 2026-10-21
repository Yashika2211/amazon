import { addDays, localParts, runEscalation, type Alert } from "@kinloop/core";
import { log } from "../log.js";
import type { Deps } from "./deps.js";

/** Persists an alert once per incident and notifies caregivers only the first time. */
export async function raiseAlert(deps: Pick<Deps, "store" | "notifier">, alert: Alert): Promise<boolean> {
  const created = await deps.store.putAlertIfAbsent(alert);
  if (!created) return false;
  const [household, members] = await Promise.all([
    deps.store.getHousehold(alert.householdId),
    deps.store.listMembers(alert.householdId),
  ]);
  if (household) {
    await deps.notifier.send(alert, household, members.filter((m) => m.role === "caregiver"));
  }
  return true;
}

/** One escalation pass for one household. Called by the scheduler and inline after writes. */
export async function escalateHousehold(
  deps: Pick<Deps, "store" | "notifier" | "clock">,
  householdId: string,
): Promise<{ alerts: number; reminders: number }> {
  const household = await deps.store.getHousehold(householdId);
  if (!household) return { alerts: 0, reminders: 0 };
  const now = deps.clock.now();
  const { date } = localParts(now, household.timezone);
  const [members, medications, todaysDoseLogs, checkIns, existingIncidentKeys] = await Promise.all([
    deps.store.listMembers(householdId),
    deps.store.listMedications(householdId),
    deps.store.listDoseLogs(householdId, date, date),
    deps.store.listCheckIns(householdId, addDays(date, -10)),
    deps.store.incidentKeys(householdId),
  ]);
  const elderName = members.find((m) => m.id === household.elderMemberId)?.name ?? "Your parent";
  const result = runEscalation({
    household,
    elderName,
    medications,
    todaysDoseLogs,
    checkIns,
    existingIncidentKeys,
    now,
  });

  let alerts = 0;
  for (const a of result.alerts) if (await raiseAlert(deps, a)) alerts++;
  let reminders = 0;
  for (const r of result.reminders) {
    const created = await deps.store.putMessage({
      id: r.incidentKey,
      householdId,
      kind: "reminder",
      fromName: "KinLoop",
      text: r.text,
      createdAt: now.toISOString(),
    });
    if (created) reminders++;
  }
  if (alerts || reminders) log.info("escalation.raised", { householdId, alerts, reminders });
  return { alerts, reminders };
}
