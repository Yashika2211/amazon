// Exports the README Mermaid architecture diagram to submission/architecture.png. Usage: node scripts/export-architecture.mjs ../../README.md ../../submission/architecture.png
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const readme = readFileSync(process.argv[2], "utf8");
const src = readme.split("```mermaid")[1].split("```")[0];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(`<html><body style="margin:0;background:#fff"><pre class="mermaid">${src.replace(/</g,"&lt;")}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:"neutral",flowchart:{htmlLabels:true}});</script></body></html>`);
await p.waitForSelector("pre.mermaid svg", { timeout: 20000 });
const el = await p.$("pre.mermaid svg");
await el.screenshot({ path: process.argv[3] });
await b.close();
console.log("architecture.png written");
