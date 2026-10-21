import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { loadConfig, type Config } from "./config.js";
import { setLogLevel } from "./log.js";
import type { SecretSource } from "./oauth/router.js";
import { pinnedClock, systemClock, type Clock } from "./services/clock.js";
import type { Deps } from "./services/deps.js";
import { bedrockWriter, InProcessDigestTrigger, LambdaDigestTrigger, templateWriter, type DigestWriter } from "./services/digest.js";
import { ConsoleNotifier, MultiNotifier, SnsNotifier, type Notifier } from "./services/notifier.js";
import { Store } from "./store/store.js";
import { DynamoTable, MemoryTable, type Table } from "./store/table.js";

const cache = new Map<string, { value: string | undefined; at: number }>();

/** Reads a SecureString from SSM Parameter Store, cached for 5 minutes per Lambda instance. */
export async function ssmParam(name: string): Promise<string | undefined> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 300_000) return hit.value;
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = r.Parameter?.Value;
  cache.set(name, { value, at: Date.now() });
  return value;
}

export function secretsFrom(config: Config): SecretSource {
  return {
    async alexaClientSecret() {
      if (config.alexaClientSecret) return config.alexaClientSecret;
      if (config.alexaClientSecretParam) return ssmParam(config.alexaClientSecretParam);
      return undefined;
    },
  };
}

export interface BuildOptions {
  config?: Config;
  table?: Table;
  clock?: Clock;
  notifier?: Notifier;
  digestWriter?: DigestWriter;
}

/** Wires real AWS services when TABLE_NAME etc. are set, in-memory fakes otherwise. */
export function buildDeps(opts: BuildOptions = {}): Deps {
  const config = opts.config ?? loadConfig();
  setLogLevel(config.logLevel);
  const table = opts.table ?? (config.tableName ? new DynamoTable(config.tableName) : new MemoryTable());
  const store = new Store(table);
  const clock = opts.clock ?? (config.demoLocalTime ? pinnedClock(config.demoLocalTime, "Asia/Kolkata") : systemClock);

  const notifier =
    opts.notifier ??
    (config.snsTopicArn || config.smsEnabled || config.telegramBotToken || config.telegramBotTokenParam
      ? new MultiNotifier([
          new ConsoleNotifier(),
          new SnsNotifier({
            ...(config.snsTopicArn ? { topicArn: config.snsTopicArn } : {}),
            smsEnabled: config.smsEnabled,
            telegramBotToken: async () =>
              config.telegramBotToken ?? (config.telegramBotTokenParam ? ssmParam(config.telegramBotTokenParam) : undefined),
          }),
        ])
      : new ConsoleNotifier());

  const useBedrock = process.env.DIGEST_WRITER !== "template" && (Boolean(config.tableName) || process.env.DIGEST_WRITER === "bedrock");
  const digestWriter = opts.digestWriter ?? (useBedrock ? bedrockWriter(config.awsRegion, [config.bedrockModelId, config.bedrockFallbackModelId]) : templateWriter);
  const digest = config.digestFunctionName
    ? new LambdaDigestTrigger(config.digestFunctionName)
    : new InProcessDigestTrigger(store, digestWriter, clock);

  return { config, table, store, clock, notifier, digest, digestWriter };
}
