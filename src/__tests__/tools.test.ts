import { getPathParamNames } from "../api-client.js";
import {
  findTool,
  GET_ALL_CAMPAIGN_STATS,
  GET_ALL_CAMPAIGNS,
  GET_ALL_INTEGRATIONS,
  GET_ALL_TRAITS,
  GET_ALL_UPLOADERS,
  GET_CAMPAIGN_INTEGRATIONS,
  GET_CAMPAIGN_LAUNCH_LINKS,
  GET_CAMPAIGN_UPLOADERS,
  GET_INTEGRATION_CAMPAIGNS,
  GET_ONE_CAMPAIGN,
  GET_ONE_CAMPAIGN_STATS,
  GET_ONE_INTEGRATION,
  GET_ONE_TRAIT,
  GET_ONE_UPLOADER,
  GET_SELF,
  GET_UPLOADER_CAMPAIGNS,
  queryParamName,
  TOOLS
} from "../tools.js";

describe("tools", () => {
  it("registers every tool under a unique name", () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes only read-only tools for now", () => {
    for (const tool of TOOLS) {
      expect(tool.method).toBe("GET");
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  /*
   * Anthropic's connector review criteria require a title on every tool alongside the hints, and
   * clients show it in place of the raw name.
   */
  it("gives every tool a human-readable title", () => {
    for (const tool of TOOLS) {
      expect(tool.annotations.title).toBeTruthy();
      expect(tool.annotations.title).not.toMatch(/^get(All|One)/);
    }
  });

  it("does not reuse a title across tools", () => {
    const titles = TOOLS.map((tool) => tool.annotations.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("declares exactly one scope per tool", () => {
    for (const tool of TOOLS) {
      expect(tool.requiredScopes).toHaveLength(1);
      expect(tool.requiredScopes[0]).toMatch(/^read:[a-z_]+$/);
    }
  });

  it("requires every path parameter as an argument", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.required.slice().sort()).toEqual(
        getPathParamNames(tool.path).slice().sort()
      );
    }
  });

  it("declares a schema property for every required argument", () => {
    for (const tool of TOOLS) {
      for (const requiredName of tool.inputSchema.required) {
        expect(tool.inputSchema.properties).toHaveProperty(requiredName);
      }
    }
  });

  it("tells the model when to call each tool, not just what it does", () => {
    for (const tool of TOOLS) {
      expect(tool.description).toContain("Call this");
    }
  });

  it("finds a tool by name", () => {
    expect(findTool("getAllCampaigns")).toBe(GET_ALL_CAMPAIGNS);
  });

  it("returns undefined for an unknown tool", () => {
    expect(findTool("deleteEverything")).toBeUndefined();
  });

  describe("endpoints and scopes", () => {
    /*
     * Scopes are the singular resource names the backend checks — see the comment block
     * in tools.ts. These assertions exist so a rename or a stray pluralization is caught
     * here rather than as a 403 at runtime.
     */
    it.each([
      [GET_SELF, "/api/v1/self", "read:business"],
      [GET_ALL_CAMPAIGNS, "/api/v1/campaigns", "read:campaign"],
      [GET_ONE_CAMPAIGN, "/api/v1/campaigns/{campaign_id}", "read:campaign"],
      [
        GET_CAMPAIGN_LAUNCH_LINKS,
        "/api/v1/campaigns/{campaign_id}/launch_links",
        "read:launch_link"
      ],
      [GET_ALL_INTEGRATIONS, "/api/v1/integrations", "read:integration"],
      [GET_ONE_INTEGRATION, "/api/v1/integrations/{integration_id}", "read:integration"],
      [GET_ALL_CAMPAIGN_STATS, "/api/v1/campaign_stats", "read:campaign_stat"],
      [GET_ONE_CAMPAIGN_STATS, "/api/v1/campaign_stats/{campaign_id}", "read:campaign_stat"],
      [
        GET_CAMPAIGN_INTEGRATIONS,
        "/api/v1/campaigns/{campaign_id}/integrations",
        "read:integration"
      ],
      [
        GET_INTEGRATION_CAMPAIGNS,
        "/api/v1/integrations/{integration_id}/campaigns",
        "read:campaign"
      ],
      [GET_ALL_UPLOADERS, "/api/v1/uploaders", "read:uploader"],
      [GET_ONE_UPLOADER, "/api/v1/uploaders/{uploader_id}", "read:uploader"],
      [GET_CAMPAIGN_UPLOADERS, "/api/v1/campaigns/{campaign_id}/uploaders", "read:uploader"],
      [GET_UPLOADER_CAMPAIGNS, "/api/v1/uploaders/{uploader_id}/campaigns", "read:campaign"],
      [GET_ALL_TRAITS, "/api/v1/traits", "read:trait"],
      [GET_ONE_TRAIT, "/api/v1/traits/{trait_id}", "read:trait"]
    ])("$name targets its documented endpoint and scope", (tool, path, scope) => {
      expect(tool.path).toBe(path);
      expect(tool.requiredScopes).toEqual([scope]);
    });

    it("gates analytics behind its own scope, not read:campaign", () => {
      for (const tool of [GET_ALL_CAMPAIGN_STATS, GET_ONE_CAMPAIGN_STATS]) {
        expect(tool.requiredScopes).not.toContain("read:campaign");
      }
    });

    /*
     * A nested route is served by the child's controller, so it is gated by the child's scope.
     * Easy to get backwards, and getting it wrong is a 403 that looks like a permissions bug.
     */
    it("gates a nested route by what it returns, not by what is in the path", () => {
      expect(GET_CAMPAIGN_UPLOADERS.requiredScopes).toEqual(["read:uploader"]);
      expect(GET_UPLOADER_CAMPAIGNS.requiredScopes).toEqual(["read:campaign"]);
      expect(GET_CAMPAIGN_INTEGRATIONS.requiredScopes).toEqual(["read:integration"]);
      expect(GET_INTEGRATION_CAMPAIGNS.requiredScopes).toEqual(["read:campaign"]);
    });

    it("covers every registered tool in the table above", () => {
      // Otherwise a new tool can be added without anyone asserting its path or scope.
      expect(TOOLS).toHaveLength(16);
    });
  });

  describe("JSON:API filters", () => {
    it("nests declared filters under filter[...] and leaves other arguments alone", () => {
      expect(queryParamName(GET_ALL_CAMPAIGN_STATS, "start_date")).toBe("filter[start_date]");
      expect(queryParamName(GET_ALL_CAMPAIGN_STATS, "end_date")).toBe("filter[end_date]");
      expect(queryParamName(GET_ALL_CAMPAIGN_STATS, "sort")).toBe("sort");
    });

    it("leaves arguments alone on tools that declare no filters", () => {
      expect(GET_ALL_INTEGRATIONS.filterParams).toBeUndefined();
      expect(queryParamName(GET_ALL_INTEGRATIONS, "start_date")).toBe("start_date");
    });

    it("offers narrowing filters on campaigns, so a large account need not be listed whole", () => {
      expect(GET_ALL_CAMPAIGNS.filterParams).toEqual(["launched", "title_contains"]);
      expect(queryParamName(GET_ALL_CAMPAIGNS, "launched")).toBe("filter[launched]");
      expect(queryParamName(GET_ALL_CAMPAIGNS, "title_contains")).toBe("filter[title_contains]");
    });

    it("declares a schema property for every filter, so the model knows it can pass one", () => {
      for (const tool of TOOLS) {
        for (const filterName of tool.filterParams ?? []) {
          expect(tool.inputSchema.properties).toHaveProperty(filterName);
          expect(tool.inputSchema.required).not.toContain(filterName);
        }
      }
    });

    it("offers date filtering on both campaign stats tools", () => {
      expect(GET_ALL_CAMPAIGN_STATS.filterParams).toEqual(["start_date", "end_date"]);
      expect(GET_ONE_CAMPAIGN_STATS.filterParams).toEqual(["start_date", "end_date"]);
    });
  });

  describe("pagination", () => {
    /*
     * Only the two collections whose backend resource opts into OptionalPaginator. Offering a page
     * argument on an endpoint that ignores it is worse than not offering one: the call succeeds,
     * returns the whole collection, and the model has no way to tell the argument did nothing.
     */
    const PAGINATED_TOOLS = [GET_ALL_CAMPAIGNS, GET_ALL_CAMPAIGN_STATS, GET_ALL_TRAITS];

    it.each(PAGINATED_TOOLS)("nests $name's page arguments under page[...]", (tool) => {
      expect(queryParamName(tool, "page_number")).toBe("page[number]");
      expect(queryParamName(tool, "page_size")).toBe("page[size]");
    });

    it.each(PAGINATED_TOOLS)("declares $name's page arguments as optional schema properties", (tool) => {
      expect(tool.inputSchema.properties).toHaveProperty("page_number");
      expect(tool.inputSchema.properties).toHaveProperty("page_size");
      expect(tool.inputSchema.required).not.toContain("page_number");
      expect(tool.inputSchema.required).not.toContain("page_size");
    });

    it("does not offer paging on collections whose endpoint ignores it", () => {
      for (const tool of TOOLS) {
        if (!PAGINATED_TOOLS.includes(tool)) {
          expect(tool.pageParams).toBeUndefined();
        }
      }
    });

    /*
     * A cap that reports a loss without naming a way to recover from it reads as a dead end. Every
     * tool that can be truncated and can be narrowed should say how.
     */
    it.each(PAGINATED_TOOLS)("tells the caller how to see past $name's cap", (tool) => {
      expect(tool.truncationRecovery).toBeDefined();
      expect(tool.truncationRecovery).toMatch(/page_number|title_contains|user_defined_id/);
    });
  });

  describe("collection caps", () => {
    /*
     * Resolving a mapping's jebbit_var used to require the whole trait list, so this tool was
     * uncapped - which then returned 55KB and blew the tool's own token limit. The filter replaced
     * that: the model asks for the handful of user_defined_ids a mapping names, so completeness is
     * no longer a correctness requirement and the default cap is safe.
     */
    it("leaves every tool on the default cap", () => {
      for (const tool of TOOLS) {
        expect(tool.maxRecords).toBeUndefined();
      }
    });

    it("lets traits be resolved by user_defined_id instead of listed", () => {
      expect(GET_ALL_TRAITS.filterParams).toContain("user_defined_id");
      expect(GET_ALL_TRAITS.inputSchema.properties).toHaveProperty("user_defined_id");
      expect(GET_ALL_TRAITS.inputSchema.required).not.toContain("user_defined_id");
    });

    it("pages traits through the backend paginator", () => {
      expect(GET_ALL_TRAITS.pageParams).toEqual(["page_number", "page_size"]);
      expect(queryParamName(GET_ALL_TRAITS, "page_size")).toBe("page[size]");
      expect(queryParamName(GET_ALL_TRAITS, "user_defined_id")).toBe("filter[user_defined_id]");
    });
  });

  describe("secret handling", () => {
    /*
     * Nothing here returns a credential, so there is nothing to redact and no redaction layer.
     *
     * The one surface that does is /api/v1/webhook_integrations, whose resource exposes the
     * shared_secret a customer verifies our webhook signatures with. It is deliberately not a
     * tool: it was the only path by which a live signing key could reach a model's context, and
     * it is a lossy subset of getAllIntegrations anyway - its resource never unscopes
     * Physical::Integration's `visible` default scope, so it silently drops any integration not
     * created in the dashboard. The endpoint still exists for the BlueConic plugin's webhook CRUD.
     */
    it("reaches no endpoint that returns a credential", () => {
      for (const tool of TOOLS) {
        expect(tool.path).not.toContain("webhook_integrations");
      }
    });
  });

  describe("getOneCampaign", () => {
    /*
     * campaign_resource exposes title/launch_date/active_iteration only. Analytics is a
     * separate endpoint, so the description has to hand the model the tool that serves it —
     * otherwise it reports the data as unavailable.
     */
    it("points the model at the tool that does serve analytics", () => {
      expect(GET_ONE_CAMPAIGN.description).toContain("getOneCampaignStats");
    });

    it("names tools that actually exist", () => {
      for (const tool of TOOLS) {
        const referencedTools = tool.description.match(/\bget(?:All|One|Campaign)[A-Za-z]+\b/g) ?? [];

        for (const referencedName of referencedTools) {
          expect(findTool(referencedName)).toBeDefined();
        }
      }
    });
  });
});

describe("brand selection", () => {
  /*
   * A credential carrying more than one read:business:* scope makes the x-jebbit-business header
   * mandatory server-side, so without a per-call argument such a credential could only ever reach
   * the single brand configured at install time.
   */
  it("offers business_id on every tool", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.properties).toHaveProperty("business_id");
    }
  });

  it("never requires business_id", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.required).not.toContain("business_id");
    }
  });

  /*
   * It is a header, not a filter or a page param — sending it as a query parameter would be
   * rejected by jsonapi-resources as an unknown parameter.
   */
  it("keeps business_id out of the filter and page namespaces", () => {
    for (const tool of TOOLS) {
      expect(tool.filterParams ?? []).not.toContain("business_id");
      expect(tool.pageParams ?? []).not.toContain("business_id");
    }
  });
});
