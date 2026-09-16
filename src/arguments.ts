import { getPathParamNames, type QueryParamScalar, type QueryParamValue } from "./api-client.js";
import { BUSINESS_ID_ARGUMENT, queryParamName, type JebbitTool } from "./tools.js";

export type ParsedToolArguments = {
  businessId?: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, QueryParamValue>;
};

function coerceQueryParamScalar(value: unknown): QueryParamScalar {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function coerceQueryParamValue(value: unknown): QueryParamValue {
  return Array.isArray(value)
    ? value.map((item) => coerceQueryParamScalar(item))
    : coerceQueryParamScalar(value);
}

/**
 * Split incoming arguments into path substitutions, query string params, and the brand selector.
 *
 * `business_id` travels as the `x-jebbit-business` header rather than a query parameter:
 * the API rejects unknown query parameters, and the backend only reads the header.
 */
export function parseToolArguments(
  tool: JebbitTool,
  args: Record<string, unknown>
): ParsedToolArguments {
  const pathParamNames = new Set(getPathParamNames(tool.path));
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, QueryParamValue> = {};
  let businessId: string | undefined;

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (key === BUSINESS_ID_ARGUMENT) {
      const trimmed = String(value).trim();
      if (trimmed) {
        businessId = trimmed;
      }
      continue;
    }

    if (pathParamNames.has(key)) {
      pathParams[key] = String(value);
      continue;
    }

    queryParams[queryParamName(tool, key)] = coerceQueryParamValue(value);
  }

  return { ...(businessId === undefined ? {} : { businessId }), pathParams, queryParams };
}
