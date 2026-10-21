// Generates the Alexa+ add-on store assets as PNGs into public/addon/ (served over HTTPS by the app):
// light + dark icons in all six required sizes, a 600x900 carousel image, and a 1200x600 banner.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../public/addon");
mkdirSync(out, { recursive: true });
const SIZES = [72, 64, 88, 126, 180, 241];

const icon = (bg, arc, dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="${bg}"/>
  <path d="M74 144a54 54 0 1 1 108 0" fill="none" stroke="${arc}" stroke-width="24" stroke-linecap="round"/>
  <circle cx="128" cy="172" r="26" fill="${dot}"/>
</svg>`;

for (const [mode, svg] of [
  ["light", icon("#0b5d4b", "#ffffff", "#ffd27a")],
  ["dark", icon("#5fd0b2", "#0b1f1a", "#0b1f1a")],
]) {
  for (const s of SIZES) await sharp(Buffer.from(svg)).resize(s, s).png().toFile(join(out, `icon-${mode}-${s}.png`));
}

const row = (y, time, name, chip, color, bg) => `
  <text x="48" y="${y}" font-size="30" fill="#5d5848" font-family="Helvetica, Arial, sans-serif">${time}</text>
  <text x="168" y="${y}" font-size="32" font-weight="700" fill="#1d1b16" font-family="Helvetica, Arial, sans-serif">${name}</text>
  <rect x="408" y="${y - 32}" width="150" height="46" rx="23" fill="${bg}"/>
  <text x="483" y="${y}" font-size="24" font-weight="700" fill="${color}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif">${chip}</text>`;

const carousel = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <rect width="600" height="900" fill="#fbf8f1"/>
  <text x="48" y="96" font-size="30" font-weight="800" fill="#0b5d4b" font-family="Helvetica, Arial, sans-serif">KinLoop</text>
  <text x="48" y="168" font-size="46" font-weight="800" fill="#1d1b16" font-family="Helvetica, Arial, sans-serif">Today, Kamala</text>
  <text x="48" y="214" font-size="26" fill="#5d5848" font-family="Helvetica, Arial, sans-serif">“Alexa, what do I need to do today?”</text>
  <line x1="48" x2="552" y1="252" y2="252" stroke="#ddd5c3" stroke-width="2"/>
  ${row(318, "8 AM", "Amlodipine", "Taken", "#1f7a3d", "#e1f3e6")}
  ${row(408, "8 AM", "Metformin", "Due now", "#8a5100", "#fbedd5")}
  ${row(498, "8 PM", "Metformin", "Later", "#4f4a3d", "#efe9dc")}
  ${row(588, "9 PM", "Atorvastatin", "Later", "#4f4a3d", "#efe9dc")}
  <rect x="48" y="650" width="504" height="170" rx="22" fill="#ffffff" stroke="#ddd5c3" stroke-width="2"/>
  <text x="76" y="706" font-size="26" font-weight="700" fill="#0b5d4b" font-family="Helvetica, Arial, sans-serif">For the family</text>
  <text x="76" y="752" font-size="26" fill="#1d1b16" font-family="Helvetica, Arial, sans-serif">“Alexa, how's Mom doing today?”</text>
  <text x="76" y="792" font-size="22" fill="#5d5848" font-family="Helvetica, Arial, sans-serif">Doses, check-ins and instant alerts.</text>
  <text x="48" y="868" font-size="18" fill="#5d5848" font-family="Helvetica, Arial, sans-serif">Not a medical device. Does not replace emergency services.</text>
</svg>`;
await sharp(Buffer.from(carousel)).png().toFile(join(out, "carousel-1.png"));

const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
  <rect width="1200" height="600" fill="#0b5d4b"/>
  <g transform="translate(90 180) scale(0.94)">${icon("#0b5d4b", "#ffffff", "#ffd27a").replace(/<\/?svg[^>]*>/g, "")}</g>
  <text x="400" y="270" font-size="72" font-weight="800" fill="#ffffff" font-family="Helvetica, Arial, sans-serif">KinLoop</text>
  <text x="400" y="340" font-size="36" fill="#dcefe8" font-family="Helvetica, Arial, sans-serif">Your parents' daily check-in,</text>
  <text x="400" y="388" font-size="36" fill="#dcefe8" font-family="Helvetica, Arial, sans-serif">through Alexa.</text>
</svg>`;
await sharp(Buffer.from(banner)).png().toFile(join(out, "banner-1.png"));
console.log(`assets written to ${out}`);
