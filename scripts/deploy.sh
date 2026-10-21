#!/usr/bin/env bash
# One-command deploy: builds the web app and Lambda bundles, makes sure the Alexa OAuth client
# secret exists in SSM Parameter Store, deploys the SAM stack, and seeds the demo household.
#
# Optional environment variables:
#   AWS_REGION (default us-east-1)   STACK_NAME (default kinloop)
#   ALERT_EMAIL          email subscribed to the SNS alert topic
#   DEMO_CAREGIVER_PHONE E.164 number for demo SMS alerts (also sets SMS_ENABLED=true)
#   ALEXA_REDIRECT_URIS  comma-separated redirect URIs from the Alexa+ Developer Hub
#   ALEXA_CLIENT_ID      OAuth client id for Alexa (default alexa-kinloop)
#   DEMO_LOCAL_TIME      pin the demo clock, e.g. 08:20
#   BEDROCK_MODEL_ID     default us.anthropic.claude-haiku-4-5-20251001-v1:0
#                        (ap-southeast-2: au.anthropic.claude-haiku-4-5-20251001-v1:0)
#   BEDROCK_FALLBACK_MODEL_ID  default us.amazon.nova-lite-v1:0 (ap-southeast-2: apac.amazon.nova-lite-v1:0)
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-kinloop}"
SECRET_PARAM="/kinloop/alexa-client-secret"

aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || {
  echo "No AWS credentials. Run 'aws login' (or set a profile) and try again." >&2
  exit 1
}

echo "▸ Installing and building"
pnpm install --frozen-lockfile >/dev/null
pnpm --filter @kinloop/web build >/dev/null
pnpm --filter @kinloop/mcp-server build

echo "▸ Checking the Alexa OAuth client secret in SSM ($SECRET_PARAM)"
if ! aws ssm get-parameter --region "$REGION" --name "$SECRET_PARAM" >/dev/null 2>&1; then
  SECRET="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)"
  aws ssm put-parameter --region "$REGION" --name "$SECRET_PARAM" --type SecureString --value "$SECRET" >/dev/null
  echo "  created a new secret. Read it with:"
  echo "  aws ssm get-parameter --region $REGION --name $SECRET_PARAM --with-decryption --query Parameter.Value --output text"
fi

OVERRIDES=("AlexaClientSecretParam=$SECRET_PARAM")
[[ -n "${ALEXA_CLIENT_ID:-}" ]] && OVERRIDES+=("AlexaClientId=$ALEXA_CLIENT_ID")
[[ -n "${ALEXA_REDIRECT_URIS:-}" ]] && OVERRIDES+=("AlexaRedirectUris=$ALEXA_REDIRECT_URIS")
[[ -n "${ALERT_EMAIL:-}" ]] && OVERRIDES+=("AlertEmail=$ALERT_EMAIL" "DemoCaregiverEmail=$ALERT_EMAIL")
[[ -n "${DEMO_CAREGIVER_PHONE:-}" ]] && OVERRIDES+=("DemoCaregiverPhone=$DEMO_CAREGIVER_PHONE" "SmsEnabled=true")
[[ -n "${DEMO_LOCAL_TIME:-}" ]] && OVERRIDES+=("DemoLocalTime=$DEMO_LOCAL_TIME")
[[ -n "${BEDROCK_MODEL_ID:-}" ]] && OVERRIDES+=("BedrockModelId=$BEDROCK_MODEL_ID")
[[ -n "${BEDROCK_FALLBACK_MODEL_ID:-}" ]] && OVERRIDES+=("BedrockFallbackModelId=$BEDROCK_FALLBACK_MODEL_ID")
[[ -n "${TELEGRAM_BOT_TOKEN_PARAM:-}" ]] && OVERRIDES+=("TelegramBotTokenParam=$TELEGRAM_BOT_TOKEN_PARAM")

echo "▸ Deploying stack $STACK to $REGION"
sam deploy \
  --template-file infra/template.yaml \
  --stack-name "$STACK" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${OVERRIDES[@]}"

BASE="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='BaseUrl'].OutputValue" --output text)"
BASE="${BASE%/}"
echo "▸ Seeding the demo household"
if ! curl -fsS -X POST "$BASE/api/demo/reset" >/dev/null; then
  echo "Seeding failed. Check the logs: aws logs tail /aws/lambda/<ApiFunction name> --region $REGION" >&2
  exit 1
fi
echo "  done"

cat <<MSG

KinLoop is live.
  Dashboard:      $BASE/
  Live demo:      $BASE/simulator/
  MCP server URL: $BASE/mcp
  Privacy/Terms:  $BASE/privacy/  $BASE/terms/

Next: alexa-ai new mcp --name "KinLoop" --locale en-US --mcp-server-url "$BASE/mcp"
MSG
