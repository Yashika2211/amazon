import Link from "next/link";

export const SAFETY = "KinLoop is not a medical device and does not replace emergency services.";

export function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="wrap" style={wide ? { maxWidth: 1400 } : undefined}>
        <header className="topbar">
          <Link href="/" className="brand">KinLoop</Link>
          <nav className="nav" aria-label="Main">
            <Link href="/dashboard/">Dashboard</Link>
            <Link href="/simulator/">Live demo</Link>
            <Link href="/setup/">Set up</Link>
            <Link href="/privacy/">Privacy</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="safety">
          <strong>{SAFETY}</strong> In an emergency, call 112 (India) or 911 (US). KinLoop's alerts are rule-based; the AI only writes summaries.
          <br />
          <Link href="/privacy/">Privacy policy</Link> · <Link href="/terms/">Terms of use</Link> · Demo data is fictional.
        </footer>
      </div>
    </>
  );
}
