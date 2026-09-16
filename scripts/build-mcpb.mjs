import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const serverOutputDir = resolve(repoRoot, "server");
const bundleEntryPoint = resolve(repoRoot, "src", "client-side-server.ts");
const bundleOutputFile = resolve(serverOutputDir, "index.mjs");
const distDir = resolve(repoRoot, "dist");

await rm(serverOutputDir, { recursive: true, force: true });
await mkdir(serverOutputDir, { recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [bundleEntryPoint],
  outfile: bundleOutputFile,
  bundle: true,
  format: "esm",
  legalComments: "none",
  minify: true,
  platform: "node",
  sourcemap: false,
  target: "node18"
});

const bundleStats = await stat(bundleOutputFile);
console.error(`Built Claude Desktop entry point at server/index.mjs (${bundleStats.size} bytes)`);
