import { parseToolArguments } from "../arguments.js";
import { GET_ALL_CAMPAIGN_STATS, GET_ALL_CAMPAIGNS, GET_ONE_CAMPAIGN } from "../tools.js";

describe("parseToolArguments", () => {
  it("splits path parameters out of the query string", () => {
    const parsed = parseToolArguments(GET_ONE_CAMPAIGN, { campaign_id: "abc123" });

    expect(parsed.pathParams).toEqual({ campaign_id: "abc123" });
    expect(parsed.queryParams).toEqual({});
  });

  it("nests declared filters under filter[...]", () => {
    const parsed = parseToolArguments(GET_ALL_CAMPAIGN_STATS, { start_date: "2024-06-01" });

    expect(parsed.queryParams).toEqual({ "filter[start_date]": "2024-06-01" });
  });

  describe("business_id", () => {
    /*
     * It selects the brand via the x-jebbit-business header. Leaking it into the query string
     * would be rejected by jsonapi-resources as an unknown parameter, and the call would still
     * target the wrong brand.
     */
    it("is lifted out of the query string", () => {
      const parsed = parseToolArguments(GET_ALL_CAMPAIGNS, { business_id: "bTUIhsye" });

      expect(parsed.businessId).toBe("bTUIhsye");
      expect(parsed.queryParams).toEqual({});
      expect(parsed.pathParams).toEqual({});
    });

    it("coexists with path and filter arguments", () => {
      const parsed = parseToolArguments(GET_ALL_CAMPAIGN_STATS, {
        business_id: "bTUIhsye",
        start_date: "2024-06-01"
      });

      expect(parsed.businessId).toBe("bTUIhsye");
      expect(parsed.queryParams).toEqual({ "filter[start_date]": "2024-06-01" });
    });

    it("is absent when not supplied, so the configured default applies", () => {
      const parsed = parseToolArguments(GET_ALL_CAMPAIGNS, {});

      expect(parsed.businessId).toBeUndefined();
    });

    it.each([[""], ["   "]])("ignores a blank value (%p) rather than sending an empty header", (value) => {
      const parsed = parseToolArguments(GET_ALL_CAMPAIGNS, { business_id: value });

      expect(parsed.businessId).toBeUndefined();
      expect(parsed.queryParams).toEqual({});
    });

    it("trims surrounding whitespace", () => {
      const parsed = parseToolArguments(GET_ALL_CAMPAIGNS, { business_id: "  bTUIhsye  " });

      expect(parsed.businessId).toBe("bTUIhsye");
    });
  });
});
