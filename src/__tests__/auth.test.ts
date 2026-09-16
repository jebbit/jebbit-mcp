import { jest } from "@jest/globals";

const BASE_REQUEST = {
  apiAudience: "public-api",
  authIssuerUrl: "https://auth.jebbit.com",
  clientId: "client-a",
  clientSecret: "secret-a"
};

function setGlobalFetch(mockFetch: typeof fetch): void {
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true
  });
}

function createTokenResponse(accessToken: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function readRequestBody(mockFetch: jest.Mock<typeof fetch>, callIndex = 0): Record<string, string> {
  const [, requestInit] = mockFetch.mock.calls[callIndex];
  return JSON.parse(String(requestInit?.body)) as Record<string, string>;
}

describe("getAccessToken", () => {
  const originalFetch = globalThis.fetch;

  async function loadAuthModule(mockFetch: typeof fetch) {
    jest.resetModules();
    setGlobalFetch(mockFetch);
    return await import("../auth.js");
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    setGlobalFetch(originalFetch);
  });

  it("caches tokens for the same issuer, audience, credentials, and scopes", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-1");
    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not reuse cached tokens across different scope sets", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("read-token"))
      .mockResolvedValueOnce(createTokenResponse("write-token"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken({ ...BASE_REQUEST, scopes: ["read:campaigns"] })
    ).resolves.toBe("read-token");
    await expect(
      getAccessToken({ ...BASE_REQUEST, scopes: ["write:campaigns"] })
    ).resolves.toBe("write-token");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached tokens across different client secrets", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("token-a"))
      .mockResolvedValueOnce(createTokenResponse("token-b"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-a");
    await expect(
      getAccessToken({ ...BASE_REQUEST, clientSecret: "secret-b" })
    ).resolves.toBe("token-b");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached tokens across different audiences", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("public-token"))
      .mockResolvedValueOnce(createTokenResponse("other-token"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("public-token");
    await expect(
      getAccessToken({ ...BASE_REQUEST, apiAudience: "other-api" })
    ).resolves.toBe("other-token");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("treats reordered and duplicated scopes as the same cache entry", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await getAccessToken({ ...BASE_REQUEST, scopes: ["write:campaigns", "read:campaigns"] });
    await getAccessToken({
      ...BASE_REQUEST,
      scopes: ["read:campaigns", "write:campaigns", "read:campaigns"]
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends the client credentials grant as JSON with sorted scopes", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await getAccessToken({
      ...BASE_REQUEST,
      scopes: ["write:campaigns", "read:campaigns"]
    });

    expect(readRequestBody(mockFetch)).toEqual({
      client_id: "client-a",
      client_secret: "secret-a",
      grant_type: "client_credentials",
      audience: "public-api",
      scope: "read:campaigns write:campaigns"
    });
  });

  it("omits the scope parameter when no scopes are requested", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await getAccessToken(BASE_REQUEST);

    expect(readRequestBody(mockFetch)).not.toHaveProperty("scope");
  });

  it("posts to the issuer token endpoint with a timeout-backed abort signal", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await getAccessToken(BASE_REQUEST);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.jebbit.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("refetches once the cached token has expired", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("token-a", 0))
      .mockResolvedValueOnce(createTokenResponse("token-b"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-a");
    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-b");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetches after the cache is cleared", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("token-a"))
      .mockResolvedValueOnce(createTokenResponse("token-b"));
    const { clearTokenCache, getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-a");
    clearTokenCache();
    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-b");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws a config error when credentials are missing", async () => {
    const mockFetch = jest.fn<typeof fetch>();
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken({ ...BASE_REQUEST, clientSecret: "" })
    ).rejects.toThrow("Jebbit OAuth credentials are not configured");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws an http error carrying the token operation when Auth0 rejects the request", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(createErrorResponse(401, { error: "invalid_client" }));
    const { getAccessToken } = await loadAuthModule(mockFetch);
    const { OAUTH_TOKEN_OPERATION } = await import("../errors.js");

    await expect(getAccessToken(BASE_REQUEST)).rejects.toMatchObject({
      name: "JebbitHttpError",
      operation: OAUTH_TOKEN_OPERATION,
      status: 401
    });
  });

  it("does not cache failed token requests", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createErrorResponse(500, { error: "server_error" }))
      .mockResolvedValueOnce(createTokenResponse("token-a"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).rejects.toThrow();
    await expect(getAccessToken(BASE_REQUEST)).resolves.toBe("token-a");
  });

  it("rejects a success response with no access token", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(createErrorResponse(200, { expires_in: 3600 }));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(getAccessToken(BASE_REQUEST)).rejects.toThrow(
      "Jebbit OAuth token response did not contain an access token"
    );
  });
});
