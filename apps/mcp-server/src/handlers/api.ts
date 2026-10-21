import serverless from "serverless-http";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeps, secretsFrom } from "../bootstrap.js";
import { createApp } from "../http/app.js";

/** Lambda entry point behind a Function URL: MCP, OAuth, REST API and the static web app. */
const deps = buildDeps();
const staticDir = join(dirname(fileURLToPath(import.meta.url)), "public");
const app = createApp({ deps, secrets: secretsFrom(deps.config), staticDir });
const wrapped = serverless(app, { binary: ["image/*", "font/*", "application/octet-stream"] });

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  const res = await wrapped(event, context);
  // Make sure the async digest invoke has left the building before Lambda freezes.
  await deps.digest.idle();
  return res;
};
