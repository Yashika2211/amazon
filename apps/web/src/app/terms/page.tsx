import { Shell } from "@/components/Shell";

export const metadata = { title: "Terms of use · KinLoop" };

export default function Terms() {
  return (
    <Shell>
      <article className="card stack" style={{ maxWidth: 820 }}>
        <h1>Terms of use</h1>
        <p className="muted">Last updated October 21, 2026.</p>
        <p>KinLoop is an open-source hackathon project, provided under the MIT License, “as is”, without warranty of any kind.</p>
        <h2>Not a medical device</h2>
        <p>KinLoop is not a medical device. It does not diagnose, treat or monitor any condition, and it does not replace emergency services, doctors or pharmacists. It never calls emergency services. In an emergency, call 112 (India) or 911 (US) yourself.</p>
        <h2>Alerts can fail</h2>
        <p>Alerts depend on Alexa, the internet, AWS, email and SMS providers. Any of them can be delayed or fail. Don't rely on KinLoop as the only way someone will know you need help.</p>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Only set up KinLoop for a person who has agreed to it.</li>
          <li>Keep sign-in names and PINs private.</li>
          <li>Medicine schedules you enter are your responsibility; check them with a doctor or pharmacist.</li>
        </ul>
        <h2>Demo data</h2>
        <p>The demo household (“Kamala” and “Arjun”) is fictional. Don't enter real health information into the public demo.</p>
        <h2>Changes</h2>
        <p>These terms may change; the date above shows the latest version.</p>
      </article>
    </Shell>
  );
}
