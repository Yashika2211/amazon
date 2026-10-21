/**
 * Minimal MCP Apps view (spec types from @modelcontextprotocol/ext-apps, protocol 2026-01-26).
 * Hand-rolled JSON-RPC over postMessage so the card stays a few KiB instead of bundling the SDK.
 */

type Slot = { medication: string; dose: string; time: string; status: string };
type Data = Record<string, unknown> & {
  medications?: Slot[];
  doses?: { taken: Slot[]; missed: Slot[]; pending: Slot[]; upcoming: Slot[] };
  appointments?: Array<{ title: string; time: string }>;
  alertsToday?: Array<{ severity: string; reason: string; acknowledged: boolean }>;
  digest?: { text: string };
  elderName?: string;
  speech?: string;
  lastCheckIn?: { mood: number } | null;
};

const LABEL: Record<string, string> = { taken: "Taken", upcoming: "Later", due: "Due now", late: "Late", missed: "Missed" };

function t12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const s = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function row(s: Slot): string {
  return `<li><span class="time">${t12(s.time)}</span><span class="name">${esc(s.medication)} <small>${esc(s.dose)}</small></span><span class="chip ${s.status}">${LABEL[s.status] ?? s.status}</span></li>`;
}

function render(d: Data): void {
  const root = document.getElementById("root")!;
  if (d.medications) {
    root.innerHTML = `<h1>Today, ${esc(d.elderName ?? "")}</h1>
      <ul class="list">${d.medications.map(row).join("") || "<li>No medicines today</li>"}</ul>
      ${(d.appointments ?? []).map((a) => `<p class="appt">📅 ${t12(a.time)} · ${esc(a.title)}</p>`).join("")}`;
    return;
  }
  if (d.doses) {
    const all = [...d.doses.taken, ...d.doses.missed, ...d.doses.pending, ...d.doses.upcoming].sort((a, b) => a.time.localeCompare(b.time));
    const urgent = (d.alertsToday ?? []).filter((a) => a.severity === "urgent" && !a.acknowledged);
    root.innerHTML = `<h1>${esc(d.elderName ?? "")} today</h1>
      ${urgent.map((a) => `<p class="alert">⚠️ ${esc(a.reason)}</p>`).join("")}
      <p class="digest">${esc(d.digest?.text ?? "")}</p>
      <ul class="list">${all.map(row).join("")}</ul>
      ${d.lastCheckIn ? `<p class="appt">Mood ${d.lastCheckIn.mood} of 5</p>` : ""}`;
    return;
  }
  root.innerHTML = `<p class="digest">${esc(d.speech ?? "")}</p>`;
}

let nextId = 1;
function send(msg: Record<string, unknown>): void {
  window.parent.postMessage({ jsonrpc: "2.0", ...msg }, "*");
}

window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { method?: string; id?: number; result?: unknown; params?: { structuredContent?: Data } };
  if (!msg || typeof msg !== "object") return;
  if (msg.id === 1 && "result" in msg) send({ method: "ui/notifications/initialized", params: {} });
  if (msg.method === "ui/notifications/tool-result" && msg.params?.structuredContent) render(msg.params.structuredContent);
});

if (window.parent !== window) {
  send({
    id: nextId++,
    method: "ui/initialize",
    params: { appInfo: { name: "KinLoop card", version: "1.0.0" }, appCapabilities: {}, protocolVersion: "2026-01-26" },
  });
}
