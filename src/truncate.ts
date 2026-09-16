/**
 * Client-side collection cap.
 *
 * A Jebbit collection endpoint returns every record the business owns unless the request asks for
 * a page. `/api/v1/campaigns`, `/api/v1/campaign_stats` and `/api/v1/traits` paginate on request,
 * so `page[number]`/`page[size]` fetch a slice while an unparameterised request keeps the original
 * whole-collection contract existing consumers depend on. The rest do not paginate at all.
 *
 * Measured on a real 3,516-campaign account: `/api/v1/campaigns` serialises to ~890KB, about
 * 228,000 tokens, and `/api/v1/campaign_stats` to ~1.1MB. Neither fits in a context window, so
 * without a cap an unparameterised call does not degrade — it fails.
 *
 * So the cap stays as a backstop for the call that asked for everything. What changed is that it
 * is no longer a dead end: a tool that can be narrowed or paged supplies `truncationRecovery`, and
 * the warning names the way to get the rest instead of only reporting the loss.
 *
 * The cap is announced in `meta` rather than applied quietly. A truncated collection that looks
 * whole is worse than an obviously partial one: it gets counted to answer "how many do I have"
 * and summarised as if it were the entire account.
 */

/**
 * Default records forwarded per collection.
 *
 * A record count is a crude proxy for context cost, because record sizes differ by an order of
 * magnitude across resources — a campaign_stats row is ~336 bytes, an integration with its
 * mappings and static values several KB. So this is a floor for the fat resources; a tool whose
 * records are small can raise it with `maxRecords`. No tool does today: the collections that
 * would have needed it are narrowable or pageable instead, which is a better answer than a
 * bigger dump.
 */
export const MAX_COLLECTION_RECORDS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cap a JSON:API collection, recording in `meta` what was dropped. Anything that is not an
 * over-length collection — a single resource, an error envelope, an already-short list — is
 * returned untouched.
 */
export function truncateCollection(
  payload: unknown,
  maxRecords: number = MAX_COLLECTION_RECORDS,
  recovery?: string
): unknown {
  if (!isPlainObject(payload) || !Array.isArray(payload.data)) {
    return payload;
  }

  const total = payload.data.length;

  if (total <= maxRecords) {
    return payload;
  }

  const existingMeta = isPlainObject(payload.meta) ? payload.meta : {};

  return {
    ...payload,
    data: payload.data.slice(0, maxRecords),
    meta: {
      ...existingMeta,
      jebbit_mcp_truncation: {
        returned: maxRecords,
        total,
        omitted: total - maxRecords,
        ...(recovery === undefined ? {} : { how_to_see_more: recovery }),
        warning:
          `PARTIAL RESPONSE. jebbit-mcp forwarded the first ${maxRecords} of ${total} records ` +
          "to keep the response inside a context window. Do not describe these as the complete " +
          `set. To answer "how many", cite the total of ${total} rather than counting the ` +
          "records below." +
          (recovery === undefined ? "" : ` ${recovery}`)
      }
    }
  };
}
