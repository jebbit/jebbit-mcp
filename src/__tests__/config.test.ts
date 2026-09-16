import {
  DEFAULT_API_AUDIENCE,
  DEFAULT_API_BASE_URL,
  DEFAULT_AUTH_ISSUER_URL,
  normalizeHttpsUrl,
  readServerConfig
} from "../config.js";

describe("normalizeHttpsUrl", () => {
  it("returns undefined for a missing value", () => {
    expect(normalizeHttpsUrl(undefined)).toBeUndefined();
    expect(normalizeHttpsUrl("")).toBeUndefined();
  });

  it("upgrades http to https", () => {
    expect(normalizeHttpsUrl("http://auth.jebbit.com")).toBe("https://auth.jebbit.com");
  });

  it("adds a missing scheme", () => {
    expect(normalizeHttpsUrl("auth.jebbit.com")).toBe("https://auth.jebbit.com");
  });

  it("strips a trailing slash so the token path can be appended", () => {
    expect(normalizeHttpsUrl("https://auth.jebbit.com/")).toBe("https://auth.jebbit.com");
  });

  describe("loopback hosts", () => {
    /*
     * The only way to point this server at a local `rails s` backend: the https rewrite would
     * otherwise produce https://localhost:3000, which cannot connect, and the
     * NODE_TLS_REJECT_UNAUTHORIZED=0 escape hatch is refused at startup.
     */
    it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
      "leaves %s on http",
      (url) => {
        expect(normalizeHttpsUrl(url)).toBe(url);
      }
    );

    it("still strips a trailing slash on a loopback url", () => {
      expect(normalizeHttpsUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    });

    it("does not exempt hosts that merely look local", () => {
      expect(normalizeHttpsUrl("http://localhost.evil.com")).toBe("https://localhost.evil.com");
      expect(normalizeHttpsUrl("http://notlocalhost")).toBe("https://notlocalhost");
      expect(normalizeHttpsUrl("http://127.0.0.1.evil.com")).toBe("https://127.0.0.1.evil.com");
    });

    it("keeps forcing https for a remote host", () => {
      expect(normalizeHttpsUrl("http://api2.jebbit.com")).toBe("https://api2.jebbit.com");
    });
  });
});

describe("readServerConfig", () => {
  it("returns null when the client id is missing", () => {
    expect(readServerConfig({ JEBBIT_CLIENT_SECRET: "secret" })).toBeNull();
  });

  it("returns null when the client secret is missing", () => {
    expect(readServerConfig({ JEBBIT_CLIENT_ID: "client" })).toBeNull();
  });

  it("treats whitespace-only credentials as missing", () => {
    expect(readServerConfig({ JEBBIT_CLIENT_ID: "  ", JEBBIT_CLIENT_SECRET: "secret" })).toBeNull();
  });

  it("applies the production host and audience defaults", () => {
    expect(readServerConfig({ JEBBIT_CLIENT_ID: "client", JEBBIT_CLIENT_SECRET: "secret" })).toEqual({
      apiAudience: DEFAULT_API_AUDIENCE,
      apiBaseUrl: DEFAULT_API_BASE_URL,
      authIssuerUrl: DEFAULT_AUTH_ISSUER_URL,
      clientId: "client",
      clientSecret: "secret"
    });
  });

  it("allows overriding the API base URL", () => {
    const config = readServerConfig({
      JEBBIT_CLIENT_ID: "client",
      JEBBIT_CLIENT_SECRET: "secret",
      JEBBIT_API_BASE_URL: "https://api2-staging.jebbit.com/"
    });

    expect(config?.apiBaseUrl).toBe("https://api2-staging.jebbit.com");
  });

  it("omits businessId when it is not configured", () => {
    const config = readServerConfig({ JEBBIT_CLIENT_ID: "client", JEBBIT_CLIENT_SECRET: "secret" });

    expect(config).not.toHaveProperty("businessId");
  });

  it("carries businessId through for the x-jebbit-business header", () => {
    const config = readServerConfig({
      JEBBIT_CLIENT_ID: "client",
      JEBBIT_CLIENT_SECRET: "secret",
      JEBBIT_BUSINESS_ID: "mybiz"
    });

    expect(config?.businessId).toBe("mybiz");
  });

  it("allows overriding the issuer and audience for non-production environments", () => {
    const config = readServerConfig({
      JEBBIT_CLIENT_ID: "client",
      JEBBIT_CLIENT_SECRET: "secret",
      JEBBIT_AUTH_ISSUER: "https://auth-staging.jebbit.com/",
      JEBBIT_API_AUDIENCE: "public-api-staging"
    });

    expect(config?.authIssuerUrl).toBe("https://auth-staging.jebbit.com");
    expect(config?.apiAudience).toBe("public-api-staging");
  });
});
