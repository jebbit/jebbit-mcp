type JebbitHttpErrorOptions = {
  operation: string;
  responseBody?: string;
  status: number;
  statusText: string;
};

/** Operation label for the Auth0 token exchange, used to tailor client-facing errors. */
export const OAUTH_TOKEN_OPERATION = "POST /oauth/token";

export const JEBBIT_CONFIGURATION_REQUIRED_MESSAGE =
  "Jebbit requires configuration before it can be used. See the documentation for setup instructions.";
export const JEBBIT_TLS_CONFIGURATION_MESSAGE =
  "Jebbit requires standard TLS certificate verification. Configure a trusted certificate before using this server.";

export class JebbitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JebbitConfigError";
  }
}

export class JebbitTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Jebbit request timed out after ${timeoutMs}ms`);
    this.name = "JebbitTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class JebbitHttpError extends Error {
  readonly operation: string;
  readonly responseBody?: string;
  readonly status: number;
  readonly statusText: string;

  constructor(message: string, options: JebbitHttpErrorOptions) {
    super(message);
    this.name = "JebbitHttpError";
    this.operation = options.operation;
    this.responseBody = options.responseBody;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

function getStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function sanitizeUpstreamMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

/*
 * Auth0 token errors arrive as { error, error_description }; Jebbit API errors use
 * { message } or { errors: [...] }. Read the descriptive fields first, then fall back
 * to the bare error code.
 */
function getUpstreamErrorMessage(responseBody?: string): string | undefined {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsedBody = JSON.parse(responseBody) as unknown;
    const message =
      getStringField(parsedBody, "error_description") ??
      getStringField(parsedBody, "message");

    if (message) {
      return sanitizeUpstreamMessage(message);
    }

    const errorValue = typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>).error
      : undefined;

    if (typeof errorValue === "string") {
      return sanitizeUpstreamMessage(errorValue);
    }

    if (typeof errorValue === "object" && errorValue !== null && !Array.isArray(errorValue)) {
      const nestedMessage = getStringField(errorValue, "message");
      return nestedMessage ? sanitizeUpstreamMessage(nestedMessage) : undefined;
    }
  } catch {
    const trimmedBody = responseBody.trim();
    if (!trimmedBody || trimmedBody.startsWith("<")) {
      return undefined;
    }

    return sanitizeUpstreamMessage(trimmedBody);
  }

  return undefined;
}

function getTokenErrorMessage(error: JebbitHttpError): string {
  if (error.status === 401) {
    return "Jebbit rejected the OAuth credentials. Verify the client ID and client secret and try again.";
  }

  if (error.status === 400 || error.status === 403) {
    return "Jebbit rejected the OAuth token request. The application may not be authorized for the requested audience or scopes.";
  }

  return "Jebbit could not issue an access token. Please try again later.";
}

export function getClientFacingErrorMessage(
  error: unknown,
  fallbackMessage = "Jebbit could not complete this request. Please try again later."
): string {
  if (error instanceof JebbitConfigError) {
    return JEBBIT_CONFIGURATION_REQUIRED_MESSAGE;
  }

  if (error instanceof JebbitTimeoutError) {
    return "Jebbit timed out while processing the request. Please try again.";
  }

  if (error instanceof JebbitHttpError) {
    if (error.operation === OAUTH_TOKEN_OPERATION) {
      return getTokenErrorMessage(error);
    }

    if (error.status === 400) {
      const upstreamMessage = getUpstreamErrorMessage(error.responseBody);

      return upstreamMessage
        ? `Jebbit could not process this request: ${upstreamMessage}`
        : "Jebbit could not process this request. Please review the tool inputs and try again.";
    }

    if (error.status === 401 || error.status === 403) {
      return "Jebbit rejected the request. Please verify the configured credentials and scopes.";
    }

    if (error.status === 404) {
      return "Jebbit could not find the requested resource.";
    }

    if (error.status === 408 || error.status === 504) {
      return "Jebbit timed out while processing the request. Please try again.";
    }

    if (error.status === 429) {
      return "Jebbit is rate limiting requests right now. Please try again in a moment.";
    }

    if (error.status >= 500) {
      return "Jebbit is temporarily unavailable. Please try again later.";
    }
  }

  return fallbackMessage;
}
