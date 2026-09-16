import { flattenJsonApiPayload } from "../flatten.js";

type Flattened = {
  data: Record<string, unknown>[];
  meta?: { jebbit_mcp_record_type?: string };
};

function campaign(id: string, title: string): Record<string, unknown> {
  return { attributes: { launch_date: null, title }, id, type: "campaigns" };
}

describe("flattenJsonApiPayload", () => {
  it("hoists attributes onto the record and drops the type envelope", () => {
    const result = flattenJsonApiPayload({
      data: [campaign("abc123", "Car Parts Trivia")]
    }) as Flattened;

    expect(result.data[0]).toEqual({ id: "abc123", launch_date: null, title: "Car Parts Trivia" });
  });

  it("reports a uniform collection's type once in meta instead of per record", () => {
    const result = flattenJsonApiPayload({
      data: [campaign("a", "One"), campaign("b", "Two")]
    }) as Flattened;

    expect(result.meta?.jebbit_mcp_record_type).toBe("campaigns");
    expect(result.data.every((record) => !("type" in record))).toBe(true);
  });

  it("keeps per-record type when a collection is mixed", () => {
    const result = flattenJsonApiPayload({
      data: [campaign("a", "One"), { attributes: { name: "Klaviyo" }, id: "b", type: "integrations" }]
    }) as Flattened;

    expect(result.meta?.jebbit_mcp_record_type).toBeUndefined();
    expect(result.data.map((record) => record.type)).toEqual(["campaigns", "integrations"]);
  });

  it("preserves existing meta alongside the record type", () => {
    const result = flattenJsonApiPayload({
      data: [campaign("a", "One")],
      meta: { jebbit_mcp_truncation: { omitted: 3316, returned: 200, total: 3516 } }
    }) as Flattened & { meta: { jebbit_mcp_truncation: unknown } };

    expect(result.meta.jebbit_mcp_truncation).toEqual({ omitted: 3316, returned: 200, total: 3516 });
    expect(result.meta.jebbit_mcp_record_type).toBe("campaigns");
  });

  it("carries through record keys that are not id, type or attributes", () => {
    const result = flattenJsonApiPayload({
      data: [
        {
          attributes: { title: "One" },
          id: "a",
          relationships: { business: { data: { id: "biz", type: "businesses" } } },
          type: "campaigns"
        }
      ]
    }) as Flattened;

    expect(result.data[0].relationships).toEqual({
      business: { data: { id: "biz", type: "businesses" } }
    });
  });

  it("does not let an id attribute overwrite the resource id", () => {
    const result = flattenJsonApiPayload({
      data: [{ attributes: { id: "not-the-key", title: "One" }, id: "abc123", type: "campaigns" }]
    }) as Flattened;

    expect(result.data[0].id).toBe("abc123");
  });

  it("flattens a single resource and keeps its type", () => {
    const result = flattenJsonApiPayload({
      data: { attributes: { name: "Jebbit Internal" }, id: "bTUIhsye", type: "businesses" }
    }) as { data: Record<string, unknown> };

    expect(result.data).toEqual({ id: "bTUIhsye", name: "Jebbit Internal", type: "businesses" });
  });

  it("leaves an empty collection alone", () => {
    const result = flattenJsonApiPayload({ data: [] }) as Flattened;

    expect(result.data).toEqual([]);
    expect(result.meta?.jebbit_mcp_record_type).toBeUndefined();
  });

  it("passes through an error envelope untouched", () => {
    const payload = { errors: [{ detail: "not found", status: "404" }] };

    expect(flattenJsonApiPayload(payload)).toBe(payload);
  });

  it("passes through non-objects untouched", () => {
    expect(flattenJsonApiPayload(null)).toBeNull();
    expect(flattenJsonApiPayload("text")).toBe("text");
  });
});
