import { brandSelectionMessage, businessIdsFromToken } from "../brands.js";

function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

describe("businessIdsFromToken", () => {
  it("reads every brand the credential grants", () => {
    const token = tokenWith({
      permissions: ["read:campaign", "read:business:RiGulurj", "read:business:xKupkbKB"]
    });

    expect(businessIdsFromToken(token)).toEqual(["RiGulurj", "xKupkbKB"]);
  });

  it("returns a single brand without complaint", () => {
    expect(businessIdsFromToken(tokenWith({ permissions: ["read:business:bTUIhsye"] }))).toEqual([
      "bTUIhsye"
    ]);
  });

  /*
   * `read:business` without an id is the implied permission the backend adds; it names no brand.
   */
  it("ignores the bare read:business permission", () => {
    expect(businessIdsFromToken(tokenWith({ permissions: ["read:business"] }))).toEqual([]);
  });

  it.each([
    ["no permissions claim", {}],
    ["permissions is not an array", { permissions: "read:business:bTUIhsye" }],
    ["permissions holds non-strings", { permissions: [42, null] }]
  ])("returns nothing when %s", (_label, payload) => {
    expect(businessIdsFromToken(tokenWith(payload))).toEqual([]);
  });

  it.each([["not-a-jwt"], [""], ["a.b"], ["a.!!!not-base64!!!.c"]])(
    "returns nothing for a malformed token (%p)",
    (token) => {
      expect(businessIdsFromToken(token)).toEqual([]);
    }
  );
});

describe("brandSelectionMessage", () => {
  describe("when a brand was named and rejected", () => {
    /*
     * A brand the credential lists but the API refuses cannot be fixed by retrying — the usual
     * cause is a business removed while its permission was left on the Auth0 client.
     */
    it("says not to retry that brand", () => {
      const message = brandSelectionMessage(["RiGulurj", "xKupkbKB"], "RiGulurj");

      expect(message).toContain("RiGulurj");
      expect(message).toMatch(/do not retry/i);
    });

    it("offers the brands that might work instead", () => {
      expect(brandSelectionMessage(["RiGulurj", "xKupkbKB"], "RiGulurj")).toContain("xKupkbKB");
    });

    it("does not offer the rejected brand back as an alternative", () => {
      const message = brandSelectionMessage(["RiGulurj", "xKupkbKB"], "RiGulurj");

      expect(message.split("Brands that may work:")[1]).not.toContain("RiGulurj");
    });

    it("says so plainly when nothing else is available", () => {
      expect(brandSelectionMessage(["RiGulurj"], "RiGulurj")).toContain("No other brand");
    });

    it("still does not blame the credentials", () => {
      expect(brandSelectionMessage(["a", "b"], "a")).not.toMatch(/reauthor|verify the configured/i);
    });
  });

  /*
   * The ids matter: /api/v1/self is subject to the same multi-brand rule, so a caller that did not
   * name a brand has no other way to discover them.
   */
  it("names the brands so the call can be retried", () => {
    const message = brandSelectionMessage(["RiGulurj", "xKupkbKB"]);

    expect(message).toContain("RiGulurj");
    expect(message).toContain("xKupkbKB");
    expect(message).toContain("business_id");
  });

  it("does not blame the credentials", () => {
    expect(brandSelectionMessage(["a", "b"])).not.toMatch(/reauthor|invalid|verify the configured/i);
  });
});
