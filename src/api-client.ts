import { fetchWithTimeout } from "./http.js";
import { JebbitConfigError, JebbitHttpError } from "./errors.js";

/** Jebbit's public API follows JSON:API, which uses its own media type. */
export const JSON_API_CONTENT_TYPE = "application/vnd.api+json";

export type QueryParamScalar = boolean | number | string;
export type QueryParamValue = QueryParamScalar | QueryParamScalar[];

export type ApiCallOptions = {
  apiBaseUrl: string;
  businessId?: string;
  method: string;
  /** Path template relative to the base URL, e.g. `/api/v1/campaigns/{campaign_id}`. */
  path: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, QueryParamValue>;
  requestBody?: unknown;
  token: string | null;
  toolName: string;
  version: string;
};

/** Substitute `{name}` placeholders in a path template. */
export function resolvePath(path: string, pathParams: Record<string, string> = {}): string {
  let resolvedPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  return resolvedPath;
}

/** Path parameter names declared in a path template, in order of appearance. */
export function getPathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function appendQueryParams(url: URL, queryParams: Record<string, QueryParamValue>): void {
  for (const [key, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

export function buildApiUrl(
  apiBaseUrl: string,
  path: string,
  queryParams: Record<string, QueryParamValue> = {},
  pathParams: Record<string, string> = {}
): URL {
  const url = new URL(resolvePath(path, pathParams), `${apiBaseUrl}/`);
  appendQueryParams(url, queryParams);
  return url;
}

function buildHeaders(options: ApiCallOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": JSON_API_CONTENT_TYPE,
    "User-Agent": `Jebbit-MCP-Client/${options.version}`,
    "X-Jebbit-MCP-Tool-Call": options.toolName
  };

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  /*
   * the API resolves the business from the JWT
   * when the token carries exactly one `read:business:<id>` scope, and only consults
   * this header when the token carries several. Sending it unconditionally is still
   * correct — the backend ignores it in the single-business case.
   */
  if (options.businessId) {
    headers["x-jebbit-business"] = options.businessId;
  }

  return headers;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.includes("json");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (isJsonContentType(contentType)) {
    return await response.json();
  }

  if (contentType.startsWith("text/") || contentType.includes("xml")) {
    return await response.text();
  }

  const responseBuffer = Buffer.from(await response.arrayBuffer());
  return {
    contentType: contentType || "application/octet-stream",
    base64: responseBuffer.toString("base64")
  };
}

/** Make an authenticated call to the Jebbit API. */
export async function makeApiCall(options: ApiCallOptions): Promise<unknown> {
  if (!options.token) {
    throw new JebbitConfigError("Jebbit access token not available");
  }

  const url = buildApiUrl(
    options.apiBaseUrl,
    options.path,
    options.queryParams,
    options.pathParams
  );
  const headers = buildHeaders(options);
  const fetchOptions: Parameters<typeof fetchWithTimeout>[1] = {
    method: options.method,
    headers
  };

  if (options.requestBody !== undefined && options.requestBody !== null) {
    headers["Content-Type"] = JSON_API_CONTENT_TYPE;
    fetchOptions.body = JSON.stringify(options.requestBody);
  }

  const response = await fetchWithTimeout(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new JebbitHttpError("Jebbit API request failed", {
      // Path template, not the resolved path — resolved ids are not error-message material.
      operation: `${options.method} ${options.path}`,
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
  }

  return await parseResponseBody(response);
}
