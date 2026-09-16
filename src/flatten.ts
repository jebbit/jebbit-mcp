/**
 * JSON:API envelope flattening.
 *
 * The API speaks JSON:API, which nests every record as `{ id, type, attributes: { ... } }`. That
 * envelope is pure overhead for a model reading the response: `type` repeats a constant that the
 * tool name already states, and `attributes` adds a level of nesting to every field access.
 *
 * Measured on a real 200-record `/api/v1/campaigns` response: 49,030 bytes as compact JSON:API,
 * 41,863 bytes flattened — a 15% saving that buys back roughly 30 more records inside the same
 * cap. The saving is larger on resources with more attributes and smaller on `campaign_stats`,
 * whose records are mostly numbers.
 *
 * Flattening is lossless here. JSON:API forbids `id` and `type` as attribute names, so hoisting
 * attributes to the top level cannot collide with the resource identity, and any record key that
 * is not `type` or `attributes` (`relationships`, `links`, a per-record `meta`) is carried through
 * untouched rather than dropped.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON:API record: an object carrying at least one of `attributes` or `id`. */
function isResourceRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && ("attributes" in value || "id" in value);
}

/**
 * Hoist one record's `attributes` to the top level.
 *
 * `type` is dropped — it is either restated once in `meta.jebbit_mcp_record_type` (uniform
 * collection) or preserved per record by the caller (mixed collection).
 */
function flattenRecord(record: Record<string, unknown>, keepType: boolean): Record<string, unknown> {
  const { attributes, type, ...rest } = record;

  const flattened: Record<string, unknown> = {
    ...rest,
    ...(isPlainObject(attributes) ? attributes : {})
  };

  /*
   * `id` is reasserted after the attribute spread rather than left to `rest`'s ordering so that a
   * non-conforming payload with an `id` attribute cannot overwrite the resource identity. The
   * spec forbids it; this makes the guarantee hold regardless.
   */
  if ("id" in record) {
    flattened.id = record.id;
  }

  if (keepType && type !== undefined) {
    flattened.type = type;
  }

  return flattened;
}

/** The shared `type` of every record, or null when the collection is empty or mixed. */
function uniformRecordType(records: unknown[]): string | null {
  const types = new Set<string>();

  for (const record of records) {
    if (!isPlainObject(record) || typeof record.type !== "string") {
      return null;
    }

    types.add(record.type);
  }

  return types.size === 1 ? [...types][0] : null;
}

/**
 * Flatten a JSON:API payload to plain objects.
 *
 * Collections whose records all share a `type` report it once as `meta.jebbit_mcp_record_type`
 * instead of repeating it per record; a mixed collection keeps `type` on each record instead.
 * Anything that is not a JSON:API payload — an error envelope, a bare value — is returned
 * untouched.
 */
export function flattenJsonApiPayload(payload: unknown): unknown {
  if (!isPlainObject(payload) || !("data" in payload)) {
    return payload;
  }

  const { data } = payload;

  if (Array.isArray(data)) {
    if (!data.every(isResourceRecord)) {
      return payload;
    }

    const recordType = uniformRecordType(data);
    const existingMeta = isPlainObject(payload.meta) ? payload.meta : {};

    return {
      ...payload,
      data: data.map((record) => flattenRecord(record, recordType === null)),
      ...(recordType === null
        ? {}
        : { meta: { ...existingMeta, jebbit_mcp_record_type: recordType } })
    };
  }

  if (isResourceRecord(data)) {
    return { ...payload, data: flattenRecord(data, true) };
  }

  return payload;
}
