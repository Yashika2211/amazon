"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Persona = "elder" | "caregiver";
type Turn = { role: "user" | "assistant"; text: string };
type Trace = { tool: string; arguments: Record<string, unknown>; ms: number; isError: boolean; text: string };
type TraceRow = Trace & { persona: Persona; at: string; totalMs: number; orchestrator: string };
type Pending = { tool: string; arguments: Record<string, unknown> } | undefined;
type FeedAlert = { incidentKey: string; kind: string; severity: string; reason: string; details: Record<string, string | number>; at: string };

const PHRASES: Record<Persona, string[]> = {
  elder: [
    "Alexa, what do I need to do today?",
    "I just took my blood pressure pill",
    "I'm feeling dizzy and I nearly fainted",
    "I'm feeling okay, slept badly",
    "Any messages from my son?",
    "Ask my son to call me",
  ],
  caregiver: ["How's Mom doing today?", "Tell Mom I'll visit on Sunday", "Add Metformin 500mg at 8 PM for Mom", "Yes, go ahead"],
};

const PANE: Record<Persona, { title: string; sub: string; icon: string }> = {
  elder: { title: "Kamala's kitchen", sub: "Jaipur · Echo Show", icon: "🏠" },
  caregiver: { title: "Arjun, in Bengaluru", sub: "Alexa app on his phone", icon: "📱" },
};

type SpeechRec = { lang: string; interimResults: boolean; onresult: (e: any) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };

function speak(text: string, enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === "en-IN") ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
  if (voice) u.voice = voice;
  u.rate = 0.98;
  window.speechSynthesis.speak(u);
}

function PaneView(props: {
  persona: Persona;
  token: string | null;
  speakOn: boolean;
  onTrace: (rows: TraceRow[]) => void;
  children?: React.ReactNode;
}) {
  const { persona, token } = props;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const recRef = useRef<SpeechRec | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = useCallback(
    async (utterance: string) => {
      if (!token || !utterance.trim()) return;
      setBusy(true);
      setTurns((t) => [...t, { role: "user", text: utterance }]);
      setText("");
      try {
        const r = await api<{ reply: string; trace: Trace[]; orchestrator: string; pending?: Pending; totalMs: number }>("/api/demo/turn", {
          method: "POST",
          token: null,
          body: JSON.stringify({ persona, text: utterance, token, history: turns.slice(-6), pending }),
        });
        setTurns((t) => [...t, { role: "assistant", text: r.reply }]);
        setPending(r.pending);
        props.onTrace(r.trace.map((x) => ({ ...x, persona, at: new Date().toISOString(), totalMs: r.totalMs, orchestrator: r.orchestrator })));
        speak(r.reply, props.speakOn);
      } catch (e) {
        setTurns((t) => [...t, { role: "assistant", text: `(${(e as Error).message})` }]);
      } finally {
        setBusy(false);
      }
    },
    [token, persona, turns, pending, props],
  );

  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      alert("Speech recognition isn't available in this browser. Type instead, or use Chrome.");
      return;
    }
    if (listening) return recRef.current?.stop();
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => void send(e.results[0][0].transcript as string);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  const p = PANE[persona];
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 560 }} aria-label={p.title}>
      <div className="spread">
        <div>
          <h2 style={{ marginBottom: 0 }}><span aria-hidden>{p.icon}</span> {p.title}</h2>
          <p className="muted small" style={{ margin: 0 }}>{p.sub}</p>
        </div>
        <span className={`chip ${busy ? "chip-info" : listening ? "chip-warn" : "chip-muted"}`} aria-live="polite">
          {busy ? "Alexa is thinking…" : listening ? "Listening…" : "Ready"}
        </span>
      </div>
      {props.children}
      <div ref={logRef} style={{ flex: 1, overflowY: "auto", margin: "12px 0", maxHeight: 360, minHeight: 200 }} aria-live="polite">
        {turns.length === 0 && <p className="muted">Tap the mic and talk, or pick a phrase below.</p>}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "flex", justifyContent: t.role === "user" ? "flex-end" : "flex-start", margin: "8px 0" }}>
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 14,
                background: t.role === "user" ? "var(--accent)" : "var(--surface-2)",
                color: t.role === "user" ? "var(--accent-fg)" : "var(--text)",
                fontSize: persona === "elder" ? 20 : 18,
              }}
            >
              {t.role === "assistant" && <b style={{ color: "var(--accent)" }}>Alexa: </b>}
              {t.text}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {PHRASES[persona].map((ph) => (
          <button key={ph} className="btn btn-ghost btn-sm" disabled={busy || !token} onClick={() => void send(ph)}>{ph}</button>
        ))}
      </div>
      <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <button type="button" className={`btn ${listening ? "btn-danger" : "btn-primary"}`} onClick={listen} disabled={busy || !token} aria-label="Speak">
          🎤
        </button>
        <label htmlFor={`in-${persona}`} className="sr-only">Say something</label>
        <input id={`in-${persona}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to Alexa…" disabled={!token} />
        <button className="btn btn-ghost" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}

export default function Simulator() {
  const [tokens, setTokens] = useState<{ elder: string; caregiver: string; mcpUrl: string } | null>(null);
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [speakOn, setSpeakOn] = useState(true);
  const [alerts, setAlerts] = useState<FeedAlert[]>([]);
  const [digest, setDigest] = useState<{ text: string; modelId: string; latencyMs: number; inputTokens: number; outputTokens: number } | null>(null);
  const [toast, setToast] = useState<FeedAlert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const since = useRef(new Date(Date.now() - 6 * 3600_000).toISOString());

  const start = useCallback(async () => {
    try {
      setTokens(await api("/api/demo/session", { method: "POST", token: null }));
    } catch (e) {
      setError(`${(e as Error).message}. Is the server running with DEMO_MODE=true?`);
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    const poll = async () => {
      try {
        const f = await api<{ alerts: FeedAlert[]; digest: typeof digest }>(`/api/demo/feed?since=${encodeURIComponent(since.current)}`, { token: null });
        setAlerts(f.alerts);
        setDigest(f.digest);
        if (seen.current === null) seen.current = new Set(f.alerts.map((a) => a.incidentKey));
        const fresh = f.alerts.find((a) => !seen.current!.has(a.incidentKey));
        if (fresh) {
          f.alerts.forEach((a) => seen.current!.add(a.incidentKey));
          setToast(fresh);
          if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, []);

  async function reset() {
    await api("/api/demo/reset", { method: "POST", token: null });
    seen.current = null;
    setTrace([]);
    setToast(null);
    await start();
    window.location.reload();
  }

  async function runScheduler() {
    const r = await api<{ alerts: number; reminders: number }>("/api/demo/escalate", { method: "POST", token: null });
    setTrace((t) => [{ persona: "caregiver", tool: "EventBridge Scheduler → escalation", arguments: {}, ms: 0, isError: false, text: `${r.alerts} alerts, ${r.reminders} reminders`, at: new Date().toISOString(), totalMs: 0, orchestrator: "rules" }, ...t]);
  }

  const addTrace = useCallback((rows: TraceRow[]) => setTrace((t) => [...rows.reverse(), ...t].slice(0, 40)), []);
  const toolRows = trace.filter((r) => r.orchestrator !== "rules");
  const p95 = (() => {
    const xs = toolRows.map((r) => r.ms).sort((a, b) => a - b);
    return xs.length ? xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)] : null;
  })();

  return (
    <Shell wide>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Live demo: one MCP server, two voices</h1>
          <p className="muted" style={{ margin: 0 }}>
            A simulated Alexa+ client: Amazon Bedrock picks tools and calls the real KinLoop MCP server over Streamable HTTP with each person's OAuth token. Fictional household.
          </p>
        </div>
        <div className="row">
          <label className="row small" style={{ fontWeight: 600, margin: 0 }}>
            <input type="checkbox" checked={speakOn} onChange={(e) => setSpeakOn(e.target.checked)} style={{ width: 22, height: 22 }} /> Speak replies
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => void runScheduler()}>Run scheduler now</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void reset()}>Reset demo</button>
        </div>
      </div>
      {error && <p className="banner-urgent" role="alert">{error}</p>}

      <div className="grid grid-2">
        <PaneView persona="elder" token={tokens?.elder ?? null} speakOn={speakOn} onTrace={addTrace} />
        <PaneView persona="caregiver" token={tokens?.caregiver ?? null} speakOn={speakOn} onTrace={addTrace}>
          {toast && (
            <div className={toast.severity === "urgent" ? "banner-urgent" : "card"} role="alert" style={{ marginTop: 12, animation: "kl-pop .3s ease-out" }}>
              <div className="spread">
                <span className="small" style={{ fontWeight: 800 }}>🔔 KinLoop · now</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
              </div>
              <p style={{ margin: "6px 0 4px" }}>{toast.reason}</p>
              <p className="small" style={{ margin: 0, fontWeight: 500 }}>
                {Object.entries(toast.details)
                  .filter(([k]) => !["symptomId", "reportedAt", "requestedAt"].includes(k))
                  .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`)
                  .join(" · ")}
                {" · "}
                {new Date(toast.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} IST
              </p>
              <p className="small" style={{ margin: "4px 0 0", fontWeight: 500 }}>Sent by Amazon SNS (email + SMS)</p>
            </div>
          )}
        </PaneView>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="spread">
            <h2>MCP trace</h2>
            <span className="chip chip-info">
              {toolRows.length} tool calls{p95 !== null ? ` · p95 ${p95} ms` : ""} · budget 500 ms
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14 }}>
              <thead>
                <tr><th>Who</th><th>Tool</th><th>Arguments</th><th style={{ textAlign: "right" }}>MCP ms</th><th>Orchestrator</th></tr>
              </thead>
              <tbody>
                {trace.length === 0 && (
                  <tr><td colSpan={5} className="muted">Tool calls appear here as Alexa makes them.</td></tr>
                )}
                {trace.map((r, i) => (
                  <tr key={i}>
                    <td>{r.persona === "elder" ? "Kamala" : "Arjun"}</td>
                    <td><b>{r.tool}</b>{r.isError ? " ⚠" : ""}</td>
                    <td style={{ maxWidth: 360, wordBreak: "break-word" }}>{JSON.stringify(r.arguments)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`chip ${r.ms < 500 ? "chip-ok" : "chip-urgent"}`}>{r.ms}</span>
                    </td>
                    <td className="muted">{r.orchestrator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card stack">
          <h2>Behind the scenes</h2>
          <div>
            <h3>Bedrock digest (async)</h3>
            {digest ? (
              <>
                <p>{digest.text}</p>
                <p className="muted small">
                  {digest.modelId} · {digest.latencyMs} ms · {digest.inputTokens} in / {digest.outputTokens} out tokens. Precomputed off the voice path.
                </p>
              </>
            ) : (
              <p className="muted">Written after each event, then stored in DynamoDB.</p>
            )}
          </div>
          <div>
            <h3>Alerts today</h3>
            {alerts.length === 0 ? <p className="muted">None yet.</p> : (
              <ul className="list">
                {alerts.slice(0, 5).map((a) => (
                  <li key={a.incidentKey}><span className={`chip ${a.severity === "urgent" ? "chip-urgent" : "chip-warn"}`}>{a.kind.replace("_", " ")}</span><span className="small">{a.reason}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <style>{`@keyframes kl-pop { from { transform: translateY(-8px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </Shell>
  );
}
