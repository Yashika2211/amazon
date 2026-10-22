"use client";
import { useEffect, useRef } from "react";

export interface UiCard {
  resourceUri: string;
  structuredContent: Record<string, unknown>;
  html?: string;
}

/**
 * A minimal MCP Apps host: renders the card HTML from resources/read in a sandboxed iframe,
 * answers its ui/initialize request, and pushes each tool result with ui/notifications/tool-result.
 */
export function EchoShow({ card }: { card: UiCard }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(card);
  latest.current = card;

  const pushResult = () => {
    frame.current?.contentWindow?.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { content: [], structuredContent: latest.current.structuredContent },
      },
      "*",
    );
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow) return;
      const msg = ev.data as { id?: number; method?: string };
      if (msg?.method === "ui/initialize") {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        frame.current?.contentWindow?.postMessage(
          {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "KinLoop simulated Alexa+", version: "1.0.0" },
              hostCapabilities: {},
              hostContext: { theme: dark ? "dark" : "light", displayMode: "inline" },
            },
          },
          "*",
        );
      }
      if (msg?.method === "ui/notifications/initialized") pushResult();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // New data for an already-loaded card: push it straight away.
  useEffect(() => {
    pushResult();
  }, [card.structuredContent]);

  if (!card.html) return null;
  return (
    <figure style={{ margin: "12px 0 0" }}>
      <div style={{ background: "#111", borderRadius: 18, padding: 10, boxShadow: "var(--shadow)" }}>
        <iframe
          ref={frame}
          title="Echo Show screen"
          srcDoc={card.html}
          sandbox="allow-scripts"
          style={{ width: "100%", height: 360, border: 0, borderRadius: 10, background: "#fff", display: "block" }}
        />
      </div>
      <figcaption className="muted small" style={{ marginTop: 6 }}>
        Echo Show · MCP Apps card <code>{card.resourceUri}</code>, loaded with resources/read
      </figcaption>
    </figure>
  );
}
