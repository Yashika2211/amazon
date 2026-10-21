"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api, signIn } from "@/lib/api";

const FIELDS: Array<{ name: string; label: string; type?: string; placeholder?: string; hint?: string; optional?: boolean }> = [
  { name: "householdName", label: "Household name", placeholder: "Amma's home, Jaipur" },
  { name: "elderName", label: "Parent's first name", placeholder: "Kamala" },
  { name: "elderUsername", label: "Parent's sign-in name", placeholder: "kamala.sharma", hint: "Used once, when linking their Alexa." },
  { name: "elderPin", label: "Parent's PIN", type: "password", placeholder: "4 to 8 digits" },
  { name: "caregiverName", label: "Your first name", placeholder: "Arjun" },
  { name: "caregiverRelation", label: "You are their…", placeholder: "son", optional: true },
  { name: "caregiverUsername", label: "Your sign-in name", placeholder: "arjun.sharma" },
  { name: "caregiverPin", label: "Your PIN", type: "password", placeholder: "4 to 8 digits" },
  { name: "caregiverEmail", label: "Your email for alerts", type: "email", optional: true },
];

export default function Setup() {
  const [form, setForm] = useState<Record<string, string>>({ timezone: "Asia/Kolkata", emergencyNumber: "112", checkInDeadline: "11:00" });
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await api("/api/households", { method: "POST", body: JSON.stringify(body), token: null });
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <Shell>
        <div className="card stack" style={{ maxWidth: 640 }}>
          <h1>Your household is ready</h1>
          <p>Next steps:</p>
          <ol>
            <li>On the parent's Alexa, enable the KinLoop add-on and sign in with the parent's name and PIN.</li>
            <li>On your own Alexa app, enable KinLoop and sign in with your name and PIN.</li>
            <li>Add medicines by voice (“Add Metformin 500 mg at 8 PM for Mom”).</li>
          </ol>
          <button className="btn btn-primary" onClick={() => void signIn()}>Open my dashboard</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form className="card stack" style={{ maxWidth: 640 }} onSubmit={submit}>
        <h1>Set up a household</h1>
        <p className="muted">One parent and one family member to start. The sign-in names and PINs are what you use when linking Alexa.</p>
        {FIELDS.map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name}>
              {f.label} {f.optional && <span className="muted small">(optional)</span>}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              required={!f.optional}
              inputMode={f.name.endsWith("Pin") ? "numeric" : undefined}
              pattern={f.name.endsWith("Pin") ? "[0-9]{4,8}" : undefined}
              value={form[f.name] ?? ""}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
            />
            {f.hint && <p className="muted small" style={{ marginTop: 4 }}>{f.hint}</p>}
          </div>
        ))}
        <div className="grid grid-2">
          <div>
            <label htmlFor="timezone">Parent's time zone</label>
            <select id="timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {["Asia/Kolkata", "America/Chicago", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Dubai", "Asia/Singapore"].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="emergencyNumber">Emergency number</label>
            <select id="emergencyNumber" value={form.emergencyNumber} onChange={(e) => setForm({ ...form, emergencyNumber: e.target.value })}>
              <option value="112">112 (India, EU)</option>
              <option value="911">911 (US, Canada)</option>
              <option value="999">999 (UK)</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="checkInDeadline">Expect a check-in by</label>
          <input id="checkInDeadline" type="time" value={form.checkInDeadline} onChange={(e) => setForm({ ...form, checkInDeadline: e.target.value })} />
        </div>
        {error && <p role="alert" style={{ color: "var(--urgent)", fontWeight: 700 }}>{error}</p>}
        <button className="btn btn-primary" disabled={state === "saving"}>{state === "saving" ? "Creating…" : "Create household"}</button>
      </form>
    </Shell>
  );
}
