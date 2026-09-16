import { MAX_COLLECTION_RECORDS, truncateCollection } from "../truncate.js";

function collection(size: number): { data: { id: string; type: string }[] } {
  return {
    data: Array.from({ length: size }, (_, index) => ({ id: `id${index}`, type: "campaigns" }))
  };
}

type Truncated = {
  data: unknown[];
  meta: {
    jebbit_mcp_truncation: { omitted: number; returned: number; total: number; warning: string };
  };
};

describe("truncateCollection recovery hint", () => {
  it("names the way to see more when the tool supplies one", () => {
    const result = truncateCollection(collection(3516), 200, "Use page_number.") as Truncated & {
      meta: { jebbit_mcp_truncation: { how_to_see_more?: string } };
    };

    expect(result.meta.jebbit_mcp_truncation.how_to_see_more).toBe("Use page_number.");
    expect(result.meta.jebbit_mcp_truncation.warning).toContain("Use page_number.");
  });

  it("omits the hint entirely when the tool has no way to ask for more", () => {
    const result = truncateCollection(collection(3516), 200) as Truncated & {
      meta: { jebbit_mcp_truncation: { how_to_see_more?: string } };
    };

    expect(result.meta.jebbit_mcp_truncation).not.toHaveProperty("how_to_see_more");
  });
});

describe("truncateCollection", () => {
  it("leaves a collection shorter than the cap alone", () => {
    const payload = collection(3);

    expect(truncateCollection(payload)).toBe(payload);
  });

  it("leaves a collection exactly at the cap alone", () => {
    const payload = collection(MAX_COLLECTION_RECORDS);

    expect(truncateCollection(payload)).toBe(payload);
  });

  it("caps a longer collection and reports what it dropped", () => {
    const result = truncateCollection(collection(3516)) as Truncated;

    expect(result.data).toHaveLength(MAX_COLLECTION_RECORDS);
    expect(result.meta.jebbit_mcp_truncation).toMatchObject({
      returned: MAX_COLLECTION_RECORDS,
      total: 3516,
      omitted: 3516 - MAX_COLLECTION_RECORDS
    });
  });

  it("honours a per-tool cap above the default", () => {
    const payload = collection(900);

    // Returned by reference, so nothing was copied or capped on the way through.
    expect(truncateCollection(payload, 1000)).toBe(payload);
  });

  it("honours a per-tool cap below the default", () => {
    const result = truncateCollection(collection(150), 50) as Truncated;

    expect(result.data).toHaveLength(50);
    expect(result.meta.jebbit_mcp_truncation.total).toBe(150);
  });

  it("keeps the first records rather than an arbitrary window", () => {
    const result = truncateCollection(collection(500), 2) as Truncated;

    expect(result.data).toEqual([
      { id: "id0", type: "campaigns" },
      { id: "id1", type: "campaigns" }
    ]);
  });

  /*
   * The model has to be able to answer "how many campaigns do I have" without counting the rows
   * it can see, which is the specific way a silent cap produces a confidently wrong answer.
   */
  it("states the true total and warns against counting the records", () => {
    const result = truncateCollection(collection(3516)) as Truncated;
    const { warning } = result.meta.jebbit_mcp_truncation;

    expect(warning).toContain("PARTIAL");
    expect(warning).toContain("3516");
    expect(warning).toContain("how many");
  });

  it("preserves meta the API already sent", () => {
    const result = truncateCollection({ ...collection(300), meta: { record_count: 300 } }) as Truncated & {
      meta: { record_count: number };
    };

    expect(result.meta.record_count).toBe(300);
    expect(result.meta.jebbit_mcp_truncation.total).toBe(300);
  });

  it("passes through a single resource, which has an object rather than an array as data", () => {
    const payload = { data: { id: "abc123", type: "campaigns" } };

    expect(truncateCollection(payload)).toBe(payload);
  });

  it("passes through an error envelope untouched", () => {
    const payload = { errors: [{ status: "403", title: "Forbidden" }] };

    expect(truncateCollection(payload)).toBe(payload);
  });

  it.each([[null], [undefined], ["a string"], [42]])("passes through %p", (payload) => {
    expect(truncateCollection(payload)).toBe(payload);
  });
});
