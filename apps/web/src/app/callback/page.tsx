"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { completeSignIn } from "@/lib/api";

export default function Callback() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeSignIn(new URLSearchParams(window.location.search))
      .then(() => window.location.replace("/dashboard/"))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <Shell>
      <div className="card" style={{ maxWidth: 520 }}>
        {error ? (
          <>
            <h1>Sign-in didn't finish</h1>
            <p className="muted" role="alert">{error}</p>
            <a className="btn btn-primary" href="/">Back to start</a>
          </>
        ) : (
          <p aria-live="polite">Signing you in…</p>
        )}
      </div>
    </Shell>
  );
}
