/** Runtime configuration, read once from the environment. See .env.example for every variable. */
export interface Config {
  /** Public origin, e.g. https://abc.lambda-url.us-east-1.on.aws. Derived from the request when unset. */
  publicBaseUrl?: string;
  tableName?: string;
  awsRegion: string;
  /** OAuth client used by Alexa+ account linking. */
  alexaClientId: string;
  /** SHA-256 of the Alexa client secret, or the SSM parameter name holding the plain secret. */
  alexaClientSecret?: string;
  alexaClientSecretParam?: string;
  /** Redirect URIs Alexa+ may use (from the Alexa+ Developer Hub), comma separated. */
  alexaRedirectUris: string[];
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  snsTopicArn?: string;
  smsEnabled: boolean;
  telegramBotToken?: string;
  telegramBotTokenParam?: string;
  digestFunctionName?: string;
  bedrockModelId: string;
  bedrockFallbackModelId: string;
  /** Enables the demo reset endpoint, the simulator and demo token minting for the seeded household only. */
  demoMode: boolean;
  /** Pins the household clock to this local "HH:MM" today, so a recorded demo is repeatable. */
  demoLocalTime?: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    ...(env.PUBLIC_BASE_URL ? { publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, "") } : {}),
    ...(env.TABLE_NAME ? { tableName: env.TABLE_NAME } : {}),
    awsRegion: env.AWS_REGION ?? "us-east-1",
    alexaClientId: env.ALEXA_CLIENT_ID ?? "alexa-kinloop",
    ...(env.ALEXA_CLIENT_SECRET ? { alexaClientSecret: env.ALEXA_CLIENT_SECRET } : {}),
    ...(env.ALEXA_CLIENT_SECRET_PARAM ? { alexaClientSecretParam: env.ALEXA_CLIENT_SECRET_PARAM } : {}),
    alexaRedirectUris: list(env.ALEXA_REDIRECT_URIS),
    accessTokenTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC ?? 3600),
    refreshTokenTtlSec: Number(env.REFRESH_TOKEN_TTL_SEC ?? 60 * 60 * 24 * 90),
    ...(env.SNS_TOPIC_ARN ? { snsTopicArn: env.SNS_TOPIC_ARN } : {}),
    smsEnabled: env.SMS_ENABLED === "true",
    ...(env.TELEGRAM_BOT_TOKEN ? { telegramBotToken: env.TELEGRAM_BOT_TOKEN } : {}),
    ...(env.TELEGRAM_BOT_TOKEN_PARAM ? { telegramBotTokenParam: env.TELEGRAM_BOT_TOKEN_PARAM } : {}),
    ...(env.DIGEST_FUNCTION_NAME ? { digestFunctionName: env.DIGEST_FUNCTION_NAME } : {}),
    bedrockModelId: env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    bedrockFallbackModelId: env.BEDROCK_FALLBACK_MODEL_ID ?? "us.amazon.nova-lite-v1:0",
    demoMode: env.DEMO_MODE === "true",
    ...(env.DEMO_LOCAL_TIME ? { demoLocalTime: env.DEMO_LOCAL_TIME } : {}),
    logLevel: (env.LOG_LEVEL as Config["logLevel"]) ?? "info",
  };
}
