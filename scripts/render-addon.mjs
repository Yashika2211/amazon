// Renders addon-package/addon.json from the template with the deployed base URL, then checks
// every constraint the Alexa+ quickstart documents. Usage: node scripts/render-addon.mjs https://xyz.lambda-url...
import { readFileSync, writeFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("Usage: node scripts/render-addon.mjs https://<your-public-base-url>");
  process.exit(1);
}
const json = JSON.parse(readFileSync("addon-package/addon.template.json", "utf8").replaceAll("{{BASE_URL}}", base));
const l = json.storeListing.locales["en-US"];
const problems = [];
const check = (ok, msg) => ok || problems.push(msg);
check(l.name.value.length <= 30, "name > 30 chars");
check(l.shortDescription.length <= 123, `shortDescription is ${l.shortDescription.length} chars (max 123)`);
check(l.fullDescription.length <= 4000, `fullDescription is ${l.fullDescription.length} chars (max 4000)`);
check(l.examplePhrases.length >= 3 && l.examplePhrases.length <= 4, "examplePhrases must be 3 or 4");
l.examplePhrases.forEach((p, i) => check(p.length <= 200, `examplePhrases[${i}] > 200 chars`));
const sizes = l.mediaAssets.icons.light.map((i) => i.size).sort();
check(JSON.stringify(sizes) === JSON.stringify(["126x126", "180x180", "241x241", "64x64", "72x72", "88x88"]), "light icons must cover all six sizes");
check(l.mediaAssets.carouselImages.length >= 1 && l.mediaAssets.carouselImages.every((c) => c.size === "600x900"), "need a 600x900 carousel image");
for (const img of [...l.mediaAssets.carouselImages, ...l.mediaAssets.bannerImages]) check(img.altText.length <= 250, `altText > 250 chars: ${img.uri}`);
const urls = JSON.stringify(json).match(/"(https?:\/\/[^"]+)"/g) ?? [];
check(urls.every((u) => u.startsWith('"https://')), "all URLs must be HTTPS");
check(json.integrations[0].type === "MCP" && json.integrations[0].config.endpoints.default.type === "HTTPS", "integration must be MCP over HTTPS");

if (problems.length) {
  console.error("addon.json problems:\n- " + problems.join("\n- "));
  process.exit(1);
}
writeFileSync("addon-package/addon.json", JSON.stringify(json, null, 2) + "\n");
console.log(`addon-package/addon.json written for ${base}`);
console.log(`shortDescription ${l.shortDescription.length}/123 · fullDescription ${l.fullDescription.length}/4000`);
