import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto("http://localhost:8787/simulator/");
await p.getByLabel("Speak replies").uncheck();
const k = p.getByRole("region", { name: "Kamala's kitchen" });
for (const t of ["Alexa, what do I need to do today?", "I just took my blood pressure pill", "I'm feeling dizzy and I nearly fainted"]) {
  await k.getByRole("button", { name: t }).click();
  await p.waitForTimeout(700);
}
const a = p.getByRole("region", { name: "Arjun, in Bengaluru" });
await a.getByRole("button", { name: "How's Mom doing today?" }).click();
await p.waitForTimeout(2000);
await p.screenshot({ path: `${out}/sim.png`, fullPage: true });
await p.goto("http://localhost:8787/dashboard/");
await p.getByRole("button", { name: "Sign in" }).click();
await p.getByLabel("Your KinLoop name").fill("arjun");
await p.getByLabel("PIN").fill("2222");
await p.getByRole("button", { name: "Allow and link" }).click();
await p.getByRole("heading", { name: "Kamala today" }).waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/dash.png`, fullPage: true });
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/dash-mobile.png`, fullPage: false });
const w = await p.evaluate(() => document.documentElement.scrollWidth);
console.log("mobile scrollWidth", w);
await b.close();
