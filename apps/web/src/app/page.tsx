"use client";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { signIn } from "@/lib/api";

export default function Home() {
  return (
    <Shell>
      <section style={{ padding: "32px 0 24px" }}>
        <p className="chip chip-info">Alexa+ add-on</p>
        <h1 style={{ marginTop: 16, maxWidth: 760 }}>Your parents' daily check-in, through Alexa.</h1>
        <p className="digest muted" style={{ maxWidth: 720 }}>
          Kamala, 72, lives in Jaipur. Her son Arjun lives in Bengaluru. She won't use apps, but she will talk.
          KinLoop lets her manage her medicines and day by voice, and gives Arjun a calm, accurate picture of the day,
          with an alert the moment something needs him.
        </p>
        <div className="row" style={{ marginTop: 24 }}>
          <Link className="btn btn-primary" href="/simulator/">Try the live demo</Link>
          <button className="btn btn-ghost" onClick={() => void signIn()}>Family sign-in</button>
          <Link className="btn btn-ghost" href="/setup/">Set up a household</Link>
        </div>
      </section>

      <section className="grid grid-2" style={{ marginTop: 24 }}>
        <div className="card stack">
          <h2>For the parent, at home</h2>
          <ul className="list">
            <li>“Alexa, what do I need to do today?”</li>
            <li>“I just took my blood pressure pill.”</li>
            <li>“I'm feeling okay, slept badly.”</li>
            <li>“I'm feeling dizzy.” Red flags alert the family immediately.</li>
            <li>“Any messages from my son?”</li>
          </ul>
        </div>
        <div className="card stack">
          <h2>For the family, anywhere</h2>
          <ul className="list">
            <li>“Alexa, how's Mom doing today?”</li>
            <li>“Tell Dad I'll visit on Sunday.”</li>
            <li>“Add Metformin 500 mg at 8 PM for Mom.” Always confirmed first.</li>
            <li>Email and SMS alerts with the reason and the numbers behind them.</li>
            <li>A daily summary written by Amazon Bedrock from logged facts only.</li>
          </ul>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Rules decide. The AI only writes.</h2>
        <p className="muted">
          Escalation is deterministic: a missed dose gets a gentle reminder at 60 minutes and a family alert at 120; no
          check-in by 11 AM alerts the family; chest pain, trouble breathing, a fall, fainting, confusion or stroke signs
          alert the family at once, and Alexa tells the parent to call emergency services. Amazon Bedrock is used only to
          write the family's daily summary, off the voice path, and is told never to give medical advice.
        </p>
      </section>
    </Shell>
  );
}
