export type ServerConfig = {
  apiAudience: string;
  apiBaseUrl: string;
  authIssuerUrl: string;
  businessId?: string;
  clientId: string;
  clientSecret: string;
};

/*
 * Jebbit is single-tenant: one Auth0 issuer, one API host, one public API audience,
 * unlike BlueConic where every customer has their own tenant host. All three are
 * overridable so the connector can be pointed at a non-production environment.
 *
 * TODO: These production values come from the API reference
 * (backend/api/swagger/v1/swagger.yaml) and config/settings/production.yml. Confirm the
 * staging equivalents and document them, so anyone pointing this at a non-prod
 * environment doesn't have to reverse-engineer the host names.
 */
export const DEFAULT_AUTH_ISSUER_URL = "https://auth.jebbit.com";
export const DEFAULT_API_BASE_URL = "https://api2.jebbit.com";
export const DEFAULT_API_AUDIENCE = "public-api";

/*
 * Hosts where plain http is left alone. Forcing https exists so credentials and campaign data
 * never cross a network in cleartext; a loopback request never leaves the machine, so the
 * guarantee is unchanged for every real deployment. Without this exception the server cannot be
 * pointed at a `rails s` backend at all: the rewrite turns http://localhost:3000 into
 * https://localhost:3000, which fails to connect, and NODE_TLS_REJECT_UNAUTHORIZED=0 is refused
 * outright at startup.
 *
 * Deliberately a fixed host list rather than a general opt-out env var, so there is no flag
 * anyone can set in production to disable this.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackHttpUrl(rawUrl: string): boolean {
  if (!/^http:\/\//i.test(rawUrl)) {
    return false;
  }

  try {
    return LOOPBACK_HOSTNAMES.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Force https and drop any trailing slash so paths can be appended cleanly.
 * Plain http survives only for loopback hosts — see LOOPBACK_HOSTNAMES.
 */
export function normalizeHttpsUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  const trimmedUrl = rawUrl.trim();
  const normalizedUrl = isLoopbackHttpUrl(trimmedUrl)
    ? trimmedUrl
    : trimmedUrl.replace(/^http:\/\//i, "https://").replace(/^(?!https:\/\/)/i, "https://");
  return normalizedUrl.endsWith("/") ? normalizedUrl.slice(0, -1) : normalizedUrl;
}

function readOptional(value?: string): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

export function readServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig | null {
  const clientId = readOptional(env.JEBBIT_CLIENT_ID);
  const clientSecret = readOptional(env.JEBBIT_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    return null;
  }

  /*
   * The default brand. A credential covering several brands can also name one per call — see the
   * `business_id` argument in src/tools.ts, which takes precedence over this.
   */
  const businessId = readOptional(env.JEBBIT_BUSINESS_ID);

  return {
    apiAudience: readOptional(env.JEBBIT_API_AUDIENCE) ?? DEFAULT_API_AUDIENCE,
    apiBaseUrl: normalizeHttpsUrl(env.JEBBIT_API_BASE_URL) ?? DEFAULT_API_BASE_URL,
    authIssuerUrl: normalizeHttpsUrl(env.JEBBIT_AUTH_ISSUER) ?? DEFAULT_AUTH_ISSUER_URL,
    ...(businessId === undefined ? {} : { businessId }),
    clientId,
    clientSecret
  };
}
