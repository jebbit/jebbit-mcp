#!/usr/bin/env node

import { createRequire } from "node:module";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { makeApiCall } from "./api-client.js";
import { parseToolArguments } from "./arguments.js";
import { brandSelectionMessage, businessIdsFromToken } from "./brands.js";
import { getAccessToken } from "./auth.js";
import { readServerConfig } from "./config.js";
import {
  getClientFacingErrorMessage,
  JebbitHttpError,
  JEBBIT_CONFIGURATION_REQUIRED_MESSAGE,
  JEBBIT_TLS_CONFIGURATION_MESSAGE
} from "./errors.js";
import { flattenJsonApiPayload } from "./flatten.js";
import { findTool, TOOLS, type JebbitTool } from "./tools.js";
import { truncateCollection } from "./truncate.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

const serverConfig = readServerConfig();

type ToolResult = {
  content: Array<{
    text: string;
    type: "text";
  }>;
  isError?: boolean;
};

function isInsecureTlsBypassEnabled(): boolean {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
}

function getRuntimeValidationMessage(): string | null {
  if (isInsecureTlsBypassEnabled()) {
    return JEBBIT_TLS_CONFIGURATION_MESSAGE;
  }

  if (!serverConfig) {
    return JEBBIT_CONFIGURATION_REQUIRED_MESSAGE;
  }

  return null;
}

function textToolResult(text: string, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    ...(isError ? { isError: true } : {})
  };
}

function formatToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

/*
 * Clients are supposed to validate against inputSchema, but not all of them do — and a
 * missing path param would otherwise be sent to the API as the literal string
 * "{campaign_id}". Fail here with a message the model can act on.
 */
function getMissingRequiredArguments(tool: JebbitTool, args: Record<string, unknown>): string[] {
  return tool.inputSchema.required.filter((name) => {
    const value = args[name];
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  });
}

const server = new Server(
  {
    name: "jebbit-mcp",
    version: packageJson.version
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, () => {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    throw new Error(runtimeValidationMessage);
  }

  return {
    tools: TOOLS.map(({ annotations, description, inputSchema, name }) => ({
      name,
      description,
      inputSchema,
      annotations
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    return textToolResult(runtimeValidationMessage, true);
  }

  const currentServerConfig = serverConfig;
  if (!currentServerConfig) {
    return textToolResult(JEBBIT_CONFIGURATION_REQUIRED_MESSAGE, true);
  }

  const tool = findTool(request.params.name);
  if (!tool) {
    // Deliberately does not echo the requested name back to the client.
    return textToolResult("The requested Jebbit tool is unavailable.", true);
  }

  console.error(`Executing tool: ${tool.name}`);

  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const missingArguments = getMissingRequiredArguments(tool, args);
  if (missingArguments.length > 0) {
    return textToolResult(
      `Missing required argument(s) for ${tool.name}: ${missingArguments.join(", ")}.`,
      true
    );
  }

  const { businessId, pathParams, queryParams } = parseToolArguments(tool, args);

  // A brand named on the call wins over the one configured at install time.
  const targetBusinessId = businessId ?? currentServerConfig.businessId;

  /*
   * TODO: Read-only dispatch. Once write tools exist this needs the dryRun /
   * batch-cap / confirmation gate described in src/tools.ts, inserted ahead of makeApiCall.
   */
  let grantedBusinessIds: string[] = [];

  try {
    /*
     * `tool.requiredScopes` is deliberately NOT passed as `scopes` here. The Auth0
     * tenant ignores a requested `scope` but rejects any scope the client has not been granted
     * with 403 access_denied, so narrowing can never tighten a token and can only fail tools
     * whose scope is missing from the grant — which is what broke getSelf, getCampaignLaunchLinks
     * and both integration tools. Least privilege comes from the tool set this server exposes,
     * not from the token. See the longer note in src/auth.ts.
     *
     * requiredScopes stays as the record of which grant each tool needs; pass it again here if
     * the tenant ever starts honouring narrowing.
     */
    const token = await getAccessToken({
      apiAudience: currentServerConfig.apiAudience,
      authIssuerUrl: currentServerConfig.authIssuerUrl,
      clientId: currentServerConfig.clientId,
      clientSecret: currentServerConfig.clientSecret
    });

    grantedBusinessIds = businessIdsFromToken(token);

    const result = await makeApiCall({
      apiBaseUrl: currentServerConfig.apiBaseUrl,
      ...(targetBusinessId === undefined ? {} : { businessId: targetBusinessId }),
      method: tool.method,
      path: tool.path,
      pathParams,
      queryParams,
      token,
      toolName: tool.name,
      version: packageJson.version
    });

    /*
     * Truncate before flattening: the cap reads `data.length`, which both shapes agree on, and
     * flattening the records that are about to be dropped is wasted work on a 3,516-record
     * collection.
     */
    const capped = truncateCollection(result, tool.maxRecords, tool.truncationRecovery);

    return textToolResult(formatToolResult(flattenJsonApiPayload(capped)));
  } catch (error: unknown) {
    console.error(`Jebbit tool execution failed for ${tool.name}`, error);

    /*
     * On a multi-brand credential a 401 is almost always the brand rules rather than a bad
     * credential, and the generic message sends people off to reauthorize something that works.
     * The brand ids are only knowable from the token, so name them here.
     */
    if (error instanceof JebbitHttpError && error.status === 401 && grantedBusinessIds.length > 1) {
      return textToolResult(brandSelectionMessage(grantedBusinessIds, targetBusinessId), true);
    }

    return textToolResult(getClientFacingErrorMessage(error), true);
  }
});

async function main(): Promise<void> {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    console.error(runtimeValidationMessage);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Jebbit MCP server started successfully (version: ${packageJson.version})`);
  console.error(`Registered ${TOOLS.length} tool(s)`);
}

process.on("SIGINT", async () => {
  console.error("Shutting down Jebbit MCP server...");
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("Shutting down Jebbit MCP server...");
  await server.close();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", reason);
  process.exit(1);
});

main().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
