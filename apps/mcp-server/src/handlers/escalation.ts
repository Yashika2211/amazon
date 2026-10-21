import { buildDeps } from "../bootstrap.js";
import { log } from "../log.js";
import { escalateHousehold } from "../services/escalation.js";

/** EventBridge Scheduler target, every 10 minutes: run the rules for every household. */
const deps = buildDeps();

export const handler = async () => {
  const ids = await deps.store.listHouseholdIds();
  let alerts = 0;
  let reminders = 0;
  for (const id of ids) {
    try {
      const r = await escalateHousehold(deps, id);
      alerts += r.alerts;
      reminders += r.reminders;
      // Keep the family digest current even on quiet days.
      deps.digest.request(id);
    } catch (err) {
      log.error("escalation.household_failed", { householdId: id, error: String(err) });
    }
  }
  await deps.digest.idle();
  log.info("escalation.run", { households: ids.length, alerts, reminders });
  return { households: ids.length, alerts, reminders };
};
