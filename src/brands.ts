/**
 * The brands a credential may act for, read out of the access token.
 *
 * the API only infers the brand when the token carries
 * exactly one `read:business:*` scope. With several it requires the `x-jebbit-business` header and
 * otherwise resolves nil, which the API reports as a flat 401 — indistinguishable from a bad
 * credential unless the caller knows this rule.
 *
 * The brand ids are in the token itself, which matters because `/api/v1/self` is subject to the
 * same rule: a multi-brand caller cannot look up the ids it is missing.
 */
const BUSINESS_SCOPE_PATTERN = /^read:business:([A-Za-z0-9_-]{8})$/;

function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const segment = token.split(".")[1];
  if (!segment) {
    return null;
  }

  try {
    const padded = segment.padEnd(segment.length + ((4 - (segment.length % 4)) % 4), "=");
    const parsed: unknown = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Brand public ids the token grants, in the order the claim lists them. */
export function businessIdsFromToken(token: string): string[] {
  const payload = decodeTokenPayload(token);
  const permissions = payload?.permissions;

  if (!Array.isArray(permissions)) {
    return [];
  }

  return permissions
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => BUSINESS_SCOPE_PATTERN.exec(entry)?.[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * Message for a 401 that the brand rules explain, rather than a bad credential. Names the ids so
 * the model can act rather than reporting a problem it has no way to diagnose.
 *
 * Two cases, and telling them apart matters: no brand named is fixed by retrying with one, while a
 * brand the API rejects is not fixable from here at all — the credential lists a brand that no
 * longer resolves, and retrying it forever is the failure mode this avoids.
 */
export function brandSelectionMessage(
  businessIds: readonly string[],
  attemptedBusinessId?: string
): string {
  if (attemptedBusinessId === undefined) {
    return (
      "Jebbit rejected the request because these credentials cover more than one brand and the " +
      `request did not say which. Retry with business_id set to one of: ${businessIds.join(", ")}. ` +
      "Ask the user which brand they mean if it is not clear. A default can also be set as the " +
      "connector's Business ID so it does not have to be given every time."
    );
  }

  const alternatives = businessIds.filter((id) => id !== attemptedBusinessId);

  return (
    `Jebbit rejected the request for brand ${attemptedBusinessId}. The credentials list it, but ` +
    "the API does not recognise it — usually a brand that has been removed while the permission " +
    "was left behind. Do not retry this brand; it will keep failing. " +
    (alternatives.length > 0
      ? `Brands that may work: ${alternatives.join(", ")}.`
      : "No other brand is available on these credentials.") +
    " Tell the user the brand is not reachable and that the credential's permissions need updating."
  );
}
