import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random secret, used for codes and tokens. */
export function randomToken(prefix = ""): string {
  return prefix + randomBytes(32).toString("base64url");
}

/** Tokens and codes are stored only as their SHA-256. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** RFC 7636: verifier is 43–128 chars of [A-Z a-z 0-9 - . _ ~]. */
export function isValidVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hashPin(pin: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return safeEqual(scryptSync(pin, salt, 32).toString("hex"), hash);
}
