"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { AdherenceChart, MoodChart } from "@/components/Charts";
import { api, ApiError, getToken, setToken, signIn, t12, timeIn } from "@/lib/api";

type Slot = { medication: string; dose: string; time: string; status: string; takenAt?: string };
type Dashboard = {
  elderName: string;
  localTime: string;
  household: { name: string; timezone: string; emergencyNumber: string; checkInDeadline: string };
  me: { name: string; role: string };
  doses: { taken: Slot[]; missed: Slot[]; pending: Slot[]; upcoming: Slot[] };
  lastCheckIn: { date: string; at: string; mood: number; sleep: string | null } | null;
  checkedInToday: boolean;
  moodTrend: string;
  digest: { text: string; source: string; generatedAt: string };
  adherence7d: Array<{ date: string; taken: number; scheduled: number }>;
  mood7d: Array<{ date: string; mood: number | null }>;
  timeline: Array<{ at: string; kind: string; title: string; detail?: string; tone: string }>;
  alerts: Array<{ incidentKey: string; kind: string; severity: string; reason: string; details: Record<string, string | number>; at: string; acknowledged: boolean }>;
  messages: Array<{ id: string; from: string; text: string; at: string; heard: boolean }>;
  medications: Array<{ id: string; name: string; dose: string; purpose: string | null; times: string[] }>;
  refills: Array<{ medicationId: string; name: string; pillsLeft: number; daysLeft: number; needsRefill: boolean }>;
};

const STATUS: Record<string, { label: string; cls: string; icon: string }> = {
  taken: { label: "Taken", cls: "chip-ok", icon: "✓" },
  missed: { label: "Missed", cls: "chip-urgent", icon: "!" },
  late: { label: "Late", cls: "chip-warn", icon: "⏱" },
  due: { label: "Due now", cls: "chip-warn", icon: "⏱" },
  upcoming: { label: "Later", cls: "chip-muted", icon: "·" },
};
const TONE: Record<string, string> = { ok: "chip-ok", info: "chip-info", warn: "chip-warn", urgent: "chip-urgent" };
const KIND_ICON: Record<string, string> = { dose: "💊", checkin: "🙂", symptom: "🩺", message: "💬", alert: "🔔" };

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!getToken()) return setNeedsLogin(true);
    try {
      setData(await api<Dashboard>("/api/dashboard"));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setNeedsLogin(true);
      } else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (needsLogin) {
    return (
      <Shell>
        <div className="card stack" style={{ maxWidth: 560 }}>
          <h1>Family dashboard</h1>
          <p className="muted">Sign in with your KinLoop name and PIN. For the demo, use <b>arjun</b> / 2222.</p>
          <button className="btn btn-primary" onClick={() => void signIn()}>Sign in</button>
        </div>
      </Shell>
    );
  }
  if (!data) return <Shell><p aria-live="polite">{error ?? "Loading…"}</p></Shell>;

  const tz = data.household.timezone;
  const slots = [...data.doses.taken, ...data.doses.missed, ...data.doses.pending, ...data.doses.upcoming].sort((a, b) => a.time.localeCompare(b.time) || a.medication.localeCompare(b.medication));
  const openUrgent = data.alerts.filter((a) => a.severity === "urgent" && !a.acknowledged);

  async function ack(key: string) {
    await api(`/api/alerts/${encodeURIComponent(key)}/ack`, { method: "POST" });
    void load();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!msg.trim()) return;
    setSending(true);
    try {
      await api("/api/messages", { method: "POST", body: JSON.stringify({ text: msg.trim() }) });
      setMsg("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Shell>
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{data.elderName} today</h1>
          <p className="muted">{data.household.name} · {t12(data.localTime)} local time</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setToken(null); setNeedsLogin(true); }}>Sign out</button>
      </div>

      {openUrgent.map((a) => (
        <div key={a.incidentKey} className="banner-urgent spread" role="alert" style={{ marginBottom: 16 }}>
          <span>⚠️ {a.reason} <span className="small">({timeIn(a.at, tz)})</span></span>
          <button className="btn btn-danger btn-sm" onClick={() => void ack(a.incidentKey)}>I'm handling it</button>
        </div>
      ))}

      <div className="grid grid-3">
        <section className="card">
          <div className="spread">
            <h2>Today's summary</h2>
            <span className="chip chip-muted small" title={`Generated ${new Date(data.digest.generatedAt).toLocaleString()}`}>
              {data.digest.source.startsWith("live") || data.digest.source === "template" ? "Live summary" : `Written by Bedrock`}
            </span>
          </div>
          <p className="digest">{data.digest.text}</p>
          <p className="muted small">Summaries restate logged facts only. They never give medical advice.</p>
        </section>
        <section className="card">
          <h2>Check-in</h2>
          {data.lastCheckIn ? (
            <>
              <p className="digest" style={{ marginBottom: 4 }}>Mood {data.lastCheckIn.mood} / 5</p>
              <p className="muted">
                {data.checkedInToday ? `Today at ${timeIn(data.lastCheckIn.at, tz)}` : `Last on ${data.lastCheckIn.date}`}
                {data.lastCheckIn.sleep ? ` · ${data.lastCheckIn.sleep} sleep` : ""}
              </p>
            </>
          ) : (
            <p className="muted">No check-ins yet.</p>
          )}
          {!data.checkedInToday && <p className="chip chip-warn">Not checked in today (expected by {t12(data.household.checkInDeadline)})</p>}
          <p className="muted small">Trend this week: {data.moodTrend}</p>
        </section>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Medicines today</h2>
          <ul className="list">
            {slots.map((s) => {
              const st = STATUS[s.status] ?? STATUS.upcoming!;
              return (
                <li key={`${s.medication}-${s.time}`} style={{ alignItems: "center" }}>
                  <span style={{ minWidth: 80 }} className="muted">{t12(s.time)}</span>
                  <span style={{ flex: 1 }}><b>{s.medication}</b> <span className="muted">{s.dose}</span></span>
                  <span className={`chip ${st.cls}`}><span aria-hidden>{st.icon}</span> {st.label}{s.takenAt ? ` ${timeIn(s.takenAt, tz)}` : ""}</span>
                </li>
              );
            })}
          </ul>
          {data.refills.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Supply</h3>
              <div className="row" style={{ gap: 8 }}>
                {data.refills.map((r) => (
                  <span key={r.medicationId} className={`chip ${r.daysLeft <= 1 ? "chip-urgent" : r.needsRefill ? "chip-warn" : "chip-muted"}`}>
                    {r.needsRefill ? "⚠ " : ""}{r.name}: {r.daysLeft} {r.daysLeft === 1 ? "day" : "days"} left ({r.pillsLeft} tablets)
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="card">
          <h2>Timeline</h2>
          {data.timeline.length === 0 ? (
            <p className="muted">Nothing logged yet today.</p>
          ) : (
            <ul className="list">
              {data.timeline.slice(0, 12).map((e, i) => (
                <li key={i}>
                  <span aria-hidden style={{ fontSize: 22 }}>{KIND_ICON[e.kind]}</span>
                  <span style={{ flex: 1 }}>
                    <span className={`chip ${TONE[e.tone]}`} style={{ marginRight: 8 }}>{timeIn(e.at, tz)}</span>
                    {e.title}
                    {e.detail && <span className="muted small" style={{ display: "block" }}>{e.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <AdherenceChart data={data.adherence7d} />
        <MoodChart data={data.mood7d} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Send {data.elderName} a message</h2>
          <form onSubmit={send} className="stack">
            <label htmlFor="msg" className="sr-only">Message</label>
            <textarea id="msg" rows={3} maxLength={300} placeholder="I'll visit on Sunday." value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn btn-primary" disabled={sending || !msg.trim()}>{sending ? "Sending…" : "Queue for Alexa"}</button>
          </form>
          <ul className="list" style={{ marginTop: 12 }}>
            {data.messages.slice(0, 4).map((m) => (
              <li key={m.id}>
                <span style={{ flex: 1 }}>{m.text} <span className="muted small">— {m.from}, {timeIn(m.at, tz)}</span></span>
                <span className={`chip ${m.heard ? "chip-ok" : "chip-muted"}`}>{m.heard ? "Heard" : "Waiting"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Alerts, last 7 days</h2>
          {data.alerts.length === 0 ? (
            <p className="muted">No alerts.</p>
          ) : (
            <ul className="list">
              {data.alerts.slice(0, 8).map((a) => (
                <li key={a.incidentKey}>
                  <span className={`chip ${a.severity === "urgent" ? "chip-urgent" : a.severity === "warning" ? "chip-warn" : "chip-info"}`}>{a.severity}</span>
                  <span style={{ flex: 1 }}>
                    {a.reason}
                    <span className="muted small" style={{ display: "block" }}>
                      {new Date(a.at).toLocaleString("en-IN", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}
                      {a.acknowledged ? " · handled" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
