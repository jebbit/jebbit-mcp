import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundleOutputFile = resolve(repoRoot, "server", "index.mjs");
const mcpbIgnoreFile = resolve(repoRoot, ".mcpbignore");

const [bundleSource, mcpbIgnore, bundleStats] = await Promise.all([
  readFile(bundleOutputFile, "utf8"),
  readFile(mcpbIgnoreFile, "utf8"),
  stat(bundleOutputFile)
]);

if (bundleStats.size === 0) {
  throw new Error("Claude Desktop bundle is empty");
}

if (bundleSource.includes("Dynamic require of")) {
  throw new Error("Claude Desktop bundle contains a dynamic require shim and may fail under ESM");
}

const ignoredLines = mcpbIgnore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (ignoredLines.includes("package.json")) {
  throw new Error(".mcpbignore excludes package.json, but the Claude Desktop runtime reads it at startup");
}

if (ignoredLines.includes("manifest.json")) {
  throw new Error(".mcpbignore excludes manifest.json, which the bundle cannot be installed without");
}

function runBundle(extraEnv) {
  const result = spawnSync(process.execPath, [bundleOutputFile], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JEBBIT_CLIENT_ID: "",
      JEBBIT_CLIENT_SECRET: "",
      ...extraEnv
    },
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

const startup = runBundle({});

if (startup.status !== 1) {
  throw new Error(
    `Expected bundle startup without credentials to exit with status 1, received ${startup.status}`
  );
}

if (!startup.output.includes("requires configuration before it can be used")) {
  throw new Error(
    "Bundle startup did not reach the expected credential validation path. Check server/index.mjs output."
  );
}

for (const forbiddenSnippet of ["JEBBIT_CLIENT_SECRET", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
  if (startup.output.includes(forbiddenSnippet)) {
    throw new Error(
      `Bundle startup leaked configuration details (${forbiddenSnippet}) that should stay out of user-facing output`
    );
  }
}

const insecureTls = runBundle({ NODE_TLS_REJECT_UNAUTHORIZED: "0" });

if (insecureTls.status !== 1) {
  throw new Error(
    `Expected bundle startup with insecure TLS to exit with status 1, received ${insecureTls.status}`
  );
}

if (!insecureTls.output.includes("requires standard TLS certificate verification")) {
  throw new Error(
    "Bundle startup did not reject insecure TLS configuration as expected. Check server/index.mjs output."
  );
}

console.error("Verified Claude Desktop bundle startup and packaging checks");
