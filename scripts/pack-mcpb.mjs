import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = resolve(repoRoot, "dist");
const packageJsonPath = resolve(repoRoot, "package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

const outputFile = resolve(distDir, `jebbit-mcp-${packageJson.version}.mcpb`);

await rm(outputFile, { force: true });

const packResult = spawnSync("mcpb", ["pack", ".", outputFile], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (packResult.error) {
  throw packResult.error;
}

if (packResult.status !== 0) {
  process.exit(packResult.status ?? 1);
}
