import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("jebbit-mcp packaging", () => {
  it("keeps the package version and the Claude manifest version in sync", async () => {
    const [packageJson, manifest] = await Promise.all([
      readFile(resolve(repoRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(resolve(repoRoot, "manifest.json"), "utf8").then(JSON.parse)
    ]);

    expect(manifest.version).toBe(packageJson.version);
  });

  it("declares a user_config field for every env var the manifest passes through", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "manifest.json"), "utf8")
    ) as {
      server: { mcp_config: { env: Record<string, string> } };
      user_config: Record<string, unknown>;
    };

    for (const value of Object.values(manifest.server.mcp_config.env)) {
      const referencedField = /^\$\{user_config\.([a-z_]+)\}$/.exec(value)?.[1];

      expect(referencedField).toBeDefined();
      expect(manifest.user_config).toHaveProperty(referencedField as string);
    }
  });

  it("marks the OAuth credential fields sensitive so they land in the OS keychain", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "manifest.json"), "utf8")
    ) as { user_config: Record<string, { sensitive?: boolean }> };

    expect(manifest.user_config.client_id.sensitive).toBe(true);
    expect(manifest.user_config.client_secret.sensitive).toBe(true);
  });
});
