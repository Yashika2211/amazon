import { buildDeps } from "../bootstrap.js";
import { log } from "../log.js";
import { refreshDigest } from "../services/digest.js";

/** Async target: writes the Bedrock family digest for one household and stores it in DynamoDB. */
const deps = buildDeps();

export const handler = async (event: { householdId?: string }) => {
  if (!event?.householdId) return { ok: false };
  const d = await refreshDigest(deps.store, deps.digestWriter, event.householdId, deps.clock);
  log.info("digest.stored", { householdId: event.householdId, modelId: d?.modelId, latencyMs: d?.latencyMs, inputTokens: d?.inputTokens, outputTokens: d?.outputTokens });
  return { ok: Boolean(d), modelId: d?.modelId };
};
