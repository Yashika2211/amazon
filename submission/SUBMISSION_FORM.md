# Devpost form: copy and paste

**Project name:** KinLoop

**Elevator pitch (under 200 characters):**
Your parents' daily check-in, through Alexa: medicines, mood and symptoms by voice, plus instant family alerts. Rules decide; the AI only writes.

**Track:** Alexa+
**Mini challenge:** AWS Builder

**Links**
- GitHub (public, MIT): https://github.com/Yashika2211/amazon
- Live demo: https://aitklljfxl5zbu3rgkec7e726m0yzgtm.lambda-url.ap-southeast-2.on.aws/simulator/
- MCP server endpoint: https://aitklljfxl5zbu3rgkec7e726m0yzgtm.lambda-url.ap-southeast-2.on.aws/mcp
- Video: <paste your YouTube link: public, English, no copyrighted music, under 3:00>

**Built with (tags):** typescript, node.js, model-context-protocol, mcp-apps, alexa, amazon-bedrock, claude, amazon-nova, aws-lambda, amazon-dynamodb, amazon-eventbridge-scheduler, amazon-sns, aws-ssm, aws-sam, oauth2, express, next.js, react, zod, vitest, playwright, github-actions

**Description:** paste `submission/DEVPOST.md`, everything below its title. It already names the track and mini challenge and has the "AWS services used and how" table.

**Product feedback:** paste `submission/PRODUCT_FEEDBACK.md`.

**Feature requests (optional):** paste `submission/FEATURE_REQUESTS.md`.

**Friction log (optional, up to 10% bonus):** paste `submission/FRICTION_LOG.md`, or link it:
https://github.com/Yashika2211/amazon/blob/main/FRICTION_LOG.md

**How to test it (for judges):**
1. Open the live demo link above. Click **Reset demo**.
2. In Kamala's kitchen, click the phrases in order: "what do I need to do today", "I just took my blood pressure pill", "I'm feeling dizzy and I nearly fainted". Watch the alert land on Arjun's side.
3. In Arjun's pane, click "How's Mom doing today?", then "I'm calling her now".
4. Open `/dashboard/` and sign in as `arjun` / `2222`.
5. To run it locally with no AWS account: `pnpm install && pnpm dev`, then http://localhost:8787/simulator/.

**Honest status note:** the real Alexa+ add-on deployment was blocked: we had no Alexa AI CLI access during the event (see friction items 2–4). Per the track rules, the demo uses our simulated Alexa+ client. It's a real MCP client over Streamable HTTP with OAuth tokens, using Amazon Bedrock tool use, against the same deployed MCP server. `addon-package/addon.template.json` is ready and validated for `alexa-ai deploy`.
