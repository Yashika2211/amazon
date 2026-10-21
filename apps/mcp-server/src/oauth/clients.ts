import type { Config } from "../config.js";
import { safeEqual, sha256 } from "./crypto.js";

/**
 * Statically registered OAuth clients. Alexa+ does not support dynamic client registration,
 * so every client is known up front.
 */
export interface OAuthClient {
  id: string;
  name: string;
  /** Public clients authenticate with PKCE only. */
  confidential: boolean;
  redirectAllowed(uri: string): boolean;
  verifySecret?(secret: string): Promise<boolean>;
}

function isLoopback(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function buildClients(config: Config, baseUrl: string, getAlexaSecret: () => Promise<string | undefined>): Map<string, OAuthClient> {
  const clients: OAuthClient[] = [
    {
      id: config.alexaClientId,
      name: "Alexa",
      confidential: true,
      // Exact match against the list from the Alexa+ Developer Hub.
      redirectAllowed: (uri) => config.alexaRedirectUris.includes(uri),
      async verifySecret(secret) {
        const expected = await getAlexaSecret();
        if (!expected) return false;
        // Compare digests so the comparison is constant-time regardless of length.
        return safeEqual(sha256(secret), sha256(expected));
      },
    },
    {
      id: "kinloop-dashboard",
      name: "KinLoop dashboard",
      confidential: false,
      redirectAllowed: (uri) => uri === `${baseUrl}/callback/` || uri === `${baseUrl}/callback` || (isLoopback(uri) && new URL(uri).pathname.startsWith("/callback")),
    },
    {
      // For MCP Inspector and other local developer tools. Loopback redirects only (RFC 8252).
      id: "kinloop-dev-tools",
      name: "Developer tools",
      confidential: false,
      redirectAllowed: isLoopback,
    },
  ];
  return new Map(clients.map((c) => [c.id, c]));
}
