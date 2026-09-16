import { jest } from "@jest/globals";

const BASE_CALL = {
  apiBaseUrl: "https://api2.jebbit.com",
  method: "GET",
  path: "/api/v1/campaigns",
  toolName: "getAllCampaigns",
  version: "1.2.3"
};

function setGlobalFetch(mockFetch: typeof fetch): void {
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true
  });
}

function createJsonApiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/vnd.api+json"
    }
  });
}

function readHeaders(mockFetch: jest.Mock<typeof fetch>): Record<string, string> {
  const [, requestInit] = mockFetch.mock.calls[0];
  return (requestInit?.headers ?? {}) as Record<string, string>;
}

describe("api-client", () => {
  const originalFetch = globalThis.fetch;

  async function loadApiClient(mockFetch: typeof fetch) {
    jest.resetModules();
    setGlobalFetch(mockFetch);
    return await import("../api-client.js");
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    setGlobalFetch(originalFetch);
  });

  describe("resolvePath", () => {
    it("substitutes path parameters", async () => {
      const { resolvePath } = await loadApiClient(jest.fn<typeof fetch>());

      expect(resolvePath("/api/v1/campaigns/{campaign_id}", { campaign_id: "abc123" })).toBe(
        "/api/v1/campaigns/abc123"
      );
    });

    it("url-encodes parameter values so they cannot break out of the path", async () => {
      const { resolvePath } = await loadApiClient(jest.fn<typeof fetch>());

      expect(resolvePath("/api/v1/campaigns/{campaign_id}", { campaign_id: "a/../b" })).toBe(
        "/api/v1/campaigns/a%2F..%2Fb"
      );
    });

    it("leaves unreplaced placeholders alone", async () => {
      const { resolvePath } = await loadApiClient(jest.fn<typeof fetch>());

      expect(resolvePath("/api/v1/campaigns/{campaign_id}", {})).toBe(
        "/api/v1/campaigns/{campaign_id}"
      );
    });
  });

  describe("getPathParamNames", () => {
    it("lists placeholders in order of appearance", async () => {
      const { getPathParamNames } = await loadApiClient(jest.fn<typeof fetch>());

      expect(getPathParamNames("/api/v1/campaigns/{campaign_id}/launch_links")).toEqual([
        "campaign_id"
      ]);
      expect(getPathParamNames("/api/v1/campaigns")).toEqual([]);
    });
  });

  describe("buildApiUrl", () => {
    it("joins the base URL and path", async () => {
      const { buildApiUrl } = await loadApiClient(jest.fn<typeof fetch>());

      expect(buildApiUrl("https://api2.jebbit.com", "/api/v1/campaigns").toString()).toBe(
        "https://api2.jebbit.com/api/v1/campaigns"
      );
    });

    it("appends scalar and array query params", async () => {
      const { buildApiUrl } = await loadApiClient(jest.fn<typeof fetch>());
      const url = buildApiUrl("https://api2.jebbit.com", "/api/v1/campaigns", {
        limit: 10,
        status: ["live", "draft"]
      });

      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.getAll("status")).toEqual(["live", "draft"]);
    });
  });

  describe("makeApiCall", () => {
    it("sends the bearer token and JSON:API accept header", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ data: [] }));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await makeApiCall({ ...BASE_CALL, token: "jwt-123" });

      expect(readHeaders(mockFetch)).toMatchObject({
        "Accept": "application/vnd.api+json",
        "Authorization": "Bearer jwt-123",
        "User-Agent": "Jebbit-MCP-Client/1.2.3",
        "X-Jebbit-MCP-Tool-Call": "getAllCampaigns"
      });
    });

    it("sends x-jebbit-business when a business is configured", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ data: [] }));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await makeApiCall({ ...BASE_CALL, token: "jwt-123", businessId: "mybiz123" });

      expect(readHeaders(mockFetch)["x-jebbit-business"]).toBe("mybiz123");
    });

    it("omits x-jebbit-business when no business is configured", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ data: [] }));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await makeApiCall({ ...BASE_CALL, token: "jwt-123" });

      expect(readHeaders(mockFetch)).not.toHaveProperty("x-jebbit-business");
    });

    it("parses the vendored JSON:API media type as JSON", async () => {
      const campaigns = {
        data: [{ id: "abc123", type: "campaigns", attributes: { title: "Summer Product Quiz" } }]
      };
      const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createJsonApiResponse(campaigns));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(makeApiCall({ ...BASE_CALL, token: "jwt-123" })).resolves.toEqual(campaigns);
    });

    it("throws a config error when no token is available", async () => {
      const mockFetch = jest.fn<typeof fetch>();
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(makeApiCall({ ...BASE_CALL, token: null })).rejects.toThrow(
        "Jebbit access token not available"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resolves path parameters into the request URL", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ data: [] }));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await makeApiCall({
        ...BASE_CALL,
        path: "/api/v1/campaigns/{campaign_id}/launch_links",
        pathParams: { campaign_id: "abc123" },
        token: "jwt-123"
      });

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api2.jebbit.com/api/v1/campaigns/abc123/launch_links");
    });

    it("reports the path template, not resolved ids, in error operations", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ errors: [] }, 404));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(
        makeApiCall({
          ...BASE_CALL,
          path: "/api/v1/campaigns/{campaign_id}",
          pathParams: { campaign_id: "abc123" },
          token: "jwt-123"
        })
      ).rejects.toMatchObject({ operation: "GET /api/v1/campaigns/{campaign_id}" });
    });

    it("throws an http error carrying the operation and status", async () => {
      const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
        createJsonApiResponse({ errors: [{ status: 403, title: "Forbidden" }] }, 403)
      );
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(makeApiCall({ ...BASE_CALL, token: "jwt-123" })).rejects.toMatchObject({
        name: "JebbitHttpError",
        operation: "GET /api/v1/campaigns",
        status: 403
      });
    });

    it("returns text bodies as strings", async () => {
      const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
        new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } })
      );
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(makeApiCall({ ...BASE_CALL, token: "jwt-123" })).resolves.toBe("plain text");
    });

    it("returns non-text bodies as base64 with their content type", async () => {
      const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" }
        })
      );
      const { makeApiCall } = await loadApiClient(mockFetch);

      await expect(makeApiCall({ ...BASE_CALL, token: "jwt-123" })).resolves.toEqual({
        contentType: "application/octet-stream",
        base64: Buffer.from([1, 2, 3]).toString("base64")
      });
    });

    it("attaches a JSON:API content type only when there is a body", async () => {
      const mockFetch = jest
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonApiResponse({ data: {} }));
      const { makeApiCall } = await loadApiClient(mockFetch);

      await makeApiCall({
        ...BASE_CALL,
        method: "POST",
        token: "jwt-123",
        requestBody: { data: { type: "campaigns" } }
      });

      const [, requestInit] = mockFetch.mock.calls[0];
      expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/vnd.api+json"
      );
      expect(requestInit?.body).toBe(JSON.stringify({ data: { type: "campaigns" } }));
    });
  });
});
