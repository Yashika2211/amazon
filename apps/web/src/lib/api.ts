"use client";

/** Same origin by default (the Lambda serves both). Set NEXT_PUBLIC_API_BASE when hosting the web app elsewhere. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

const TOKEN_KEY = "kinloop.token";
const PKCE_KEY = "kinloop.pkce";

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string | null): void {
  const s = safeStorage();
  if (!s) return;
  if (token) s.setItem(TOKEN_KEY, token);
  else s.removeItem(TOKEN_KEY);
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function origin(): string {
  return API_BASE || window.location.origin;
}

/** Starts the OAuth 2.1 authorization code flow with PKCE (S256) as the public dashboard client. */
export async function signIn(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  safeStorage()?.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const redirect = `${window.location.origin}/callback/`;
  const u = new URL(`${origin()}/oauth/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: "kinloop-dashboard",
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "kinloop",
    resource: `${origin()}/mcp`,
  }).toString();
  window.location.assign(u.toString());
}

export async function completeSignIn(params: URLSearchParams): Promise<void> {
  const saved = JSON.parse(safeStorage()?.getItem(PKCE_KEY) ?? "null") as { verifier: string; state: string } | null;
  if (params.get("error")) throw new Error(params.get("error_description") ?? params.get("error")!);
  if (!saved || params.get("state") !== saved.state) throw new Error("Sign-in expired. Please try again.");
  const res = await fetch(`${origin()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.get("code") ?? "",
      redirect_uri: `${window.location.origin}/callback/`,
      code_verifier: saved.verifier,
      client_id: "kinloop-dashboard",
      resource: `${origin()}/mcp`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description ?? "Sign-in failed.");
  safeStorage()?.removeItem(PKCE_KEY);
  setToken(body.access_token);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const token = init.token === undefined ? getToken() : init.token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
  return body as T;
}

export function timeIn(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function t12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const s = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`;
}
