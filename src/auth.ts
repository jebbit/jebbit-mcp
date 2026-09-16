import { createHash } from "node:crypto";

import { fetchWithTimeout } from "./http.js";
import { JebbitConfigError, JebbitHttpError, OAUTH_TOKEN_OPERATION } from "./errors.js";

export type AccessTokenRequest = {
  apiAudience: string;
  authIssuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: readonly string[];
};

type CachedToken = {
  accessToken: string;
  tokenExpiry: number;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
};

/*
 * Only used when Auth0 omits expires_in, which it does not do in practice. The API
 * reference documents a 24-hour token, but the real lifetime is configured per Auth0
 * application, so never hardcode an expectation: read expires_in off the response and
 * refresh early.
 */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_RATIO = 0.9;

const tokenCache = new Map<string, CachedToken>();

function normalizeScopes(scopes: readonly string[] = []): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0))].sort();
}

/*
 * Hash the credentials rather than keying on them directly so a cache dump can never
 * leak the secret. Prefixing the client id length keeps `id + secret` unambiguous.
 */
function createCredentialKey(request: AccessTokenRequest, normalizedScopes: readonly string[]): string {
  const credentialHash = createHash("sha256")
    .update(`${request.clientId.length}:${request.clientId}:${request.clientSecret}`)
    .digest("hex");
  return [
    request.authIssuerUrl,
    request.apiAudience,
    credentialHash,
    normalizedScopes.join(" ")
  ].join("::");
}

/**
 * Get an OAuth2 access token from Auth0 using the client credentials flow.
 *
 * Tokens are cached in memory per (issuer, audience, credential, scope set) and refreshed
 * before expiry. Requesting only the scopes an operation needs keeps each token
 * least-privilege — see the caveat on `scopes` below.
 */
export async function getAccessToken(request: AccessTokenRequest): Promise<string> {
  if (!request.authIssuerUrl || !request.apiAudience || !request.clientId || !request.clientSecret) {
    throw new JebbitConfigError("Jebbit OAuth credentials are not configured");
  }

  const normalizedScopes = normalizeScopes(request.scopes);
  const credentialKey = createCredentialKey(request, normalizedScopes);
  const cachedToken = tokenCache.get(credentialKey);
  if (cachedToken && Date.now() < cachedToken.tokenExpiry) {
    return cachedToken.accessToken;
  }

  /*
   * Matches the request the Jebbit backend itself makes in
   * the API's auth endpoint — a JSON body with the credentials inline, rather than
   * the form-encoded Basic-auth shape BlueConic uses.
   *
   * `scope` narrowing was verified against the Auth0 tenant and it does
   * NOT work: a token requested with scopes: ["read:campaign"] came back carrying the client's
   * full grant in its `scope` claim, while a scope absent from the grant was refused outright
   * with 403 access_denied. Narrowing is therefore decorative at best and breaking at worst, and
   * no caller passes `scopes` today — see the note at the getAccessToken call in
   * client-side-server.ts. The parameter is kept because it is correct OAuth and costs nothing;
   * if Jebbit moves to a tenant that honours it, that call site is the only thing to change back.
   */
  const requestBody: Record<string, string> = {
    client_id: request.clientId,
    client_secret: request.clientSecret,
    grant_type: "client_credentials",
    audience: request.apiAudience
  };

  if (normalizedScopes.length > 0) {
    requestBody.scope = normalizedScopes.join(" ");
  }

  const response = await fetchWithTimeout(`${request.authIssuerUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new JebbitHttpError("Jebbit OAuth token request failed", {
      operation: OAUTH_TOKEN_OPERATION,
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
  }

  const tokenData = await response.json() as TokenResponse;
  if (!tokenData.access_token) {
    throw new JebbitHttpError("Jebbit OAuth token response did not contain an access token", {
      operation: OAUTH_TOKEN_OPERATION,
      status: response.status,
      statusText: response.statusText
    });
  }

  const expiresInSeconds = tokenData.expires_in ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  tokenCache.set(credentialKey, {
    accessToken: tokenData.access_token,
    tokenExpiry: Date.now() + (expiresInSeconds * 1000 * TOKEN_REFRESH_RATIO)
  });

  return tokenData.access_token;
}

/** Drop every cached token. Intended for tests and credential rotation. */
export function clearTokenCache(): void {
  tokenCache.clear();
}
