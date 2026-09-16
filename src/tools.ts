import { getPathParamNames } from "./api-client.js";

export type ToolAnnotations = {
  /**
   * Human-readable label shown by clients in place of the raw tool name. Anthropic's connector
   * review criteria require it alongside the read-only / destructive hints.
   */
  title: string;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  readOnlyHint: boolean;
};

export type InputSchema = {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  type: "object";
};

export type JebbitTool = {
  annotations: ToolAnnotations;
  description: string;
  /**
   * Argument names the API expects as JSON:API filters — sent as `filter[name]=value` rather
   * than a bare `name=value`, which the API rejects as an unknown parameter.
   */
  filterParams?: readonly string[];
  inputSchema: InputSchema;
  /**
   * Records forwarded from this tool's collection before truncation, overriding
   * MAX_COLLECTION_RECORDS. Set it where the default's token cost is wrong for the record size.
   */
  maxRecords?: number;
  method: string;
  /**
   * Argument names the API expects as JSON:API pagination — sent as `page[size]` / `page[number]`
   * rather than bare names. Set only on tools whose endpoint paginates; sending `page` to one that
   * does not is ignored, which would look like the argument silently doing nothing.
   */
  pageParams?: readonly string[];
  /** Path template relative to the API base URL, e.g. `/api/v1/campaigns/{campaign_id}`. */
  path: string;
  name: string;
  /**
   * The Auth0 scopes this tool's endpoint checks. Documentation only — not sent when requesting
   * a token, because the tenant ignores scope narrowing. See the note in client-side-server.ts.
   * Kept per tool because the nested routes are gated by the child's scope, which is easy to get
   * wrong and surfaces as a 403 that says nothing about which scope was missing.
   */
  requiredScopes: readonly string[];
  /**
   * Appended to the truncation warning when this tool's collection is capped, naming the concrete
   * way to get the rest. A cap that says "there is more" without saying "here is how to ask for
   * it" reads as a dead end, which is how a model treats it.
   */
  truncationRecovery?: string;
};

const READ_HINTS = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true
} as const;

function readAnnotations(title: string): ToolAnnotations {
  return { title, ...READ_HINTS };
}

/*
 * Scopes are the singular resource name the API checks — `read:campaign`, not `read:campaigns`.
 * Pluralizing them returns 403.
 *
 * A nested route is gated by the scope of what it RETURNS, not what is in the path:
 * /campaigns/{id}/uploaders needs read:uploader, while /uploaders/{id}/campaigns needs
 * read:campaign. Counterintuitive, and easy to get backwards.
 *
 * These are documentation only - src/auth.ts does not send `scope` on the token request, because
 * the Auth0 tenant ignores narrowing and hard-403s on any scope the client does not already hold.
 * The token always carries the client's entire grant, so least privilege has to come from which
 * tools ship rather than from per-operation scoping.
 */
const READ_BUSINESS_SCOPE = "read:business";
const READ_CAMPAIGN_SCOPE = "read:campaign";
const READ_LAUNCH_LINK_SCOPE = "read:launch_link";
const READ_INTEGRATION_SCOPE = "read:integration";
const READ_CAMPAIGN_STAT_SCOPE = "read:campaign_stat";
const READ_UPLOADER_SCOPE = "read:uploader";
const READ_TRAIT_SCOPE = "read:trait";

/**
 * Name of the optional argument that selects which brand a call is for. Handled specially by the
 * dispatcher — it becomes the `x-jebbit-business` header, never a query parameter.
 */
export const BUSINESS_ID_ARGUMENT = "business_id";

/*
 * Offered on every tool because a credential scoped to several brands makes the header mandatory:
 * the API only infers the brand when the token carries
 * exactly one `read:business:*`, and otherwise returns nil — surfacing as 401 on every call.
 * Without a per-call argument a multi-brand credential could only ever reach the one brand
 * configured at install time.
 */
const BUSINESS_ID_PROPERTY: Record<string, Record<string, unknown>> = {
  [BUSINESS_ID_ARGUMENT]: {
    type: "string",
    description:
      "Optional. The public id of the brand to query, e.g. abc123. Only needed when the credential " +
      "covers more than one brand and no default was configured, or to reach a brand other than the " +
      "default. Obtain it from getSelf, or from the user."
  }
};

/** Build an input schema whose only arguments are the path template's parameters. */
function pathParamSchema(path: string, descriptions: Record<string, string>): InputSchema {
  const paramNames = getPathParamNames(path);

  return withBusinessId({
    type: "object",
    properties: Object.fromEntries(
      paramNames.map((paramName) => [
        paramName,
        {
          type: "string",
          description: descriptions[paramName] ?? `Path parameter: ${paramName}`
        }
      ])
    ),
    required: paramNames
  });
}

/** Every tool accepts the brand selector, so it is folded into both schema builders. */
function withBusinessId(schema: InputSchema): InputSchema {
  return {
    type: "object",
    properties: { ...schema.properties, ...BUSINESS_ID_PROPERTY },
    required: schema.required
  };
}

const NO_ARGUMENTS: InputSchema = withBusinessId({
  type: "object",
  properties: {},
  required: []
});

/** Add optional arguments to a schema without making any of them required. */
function withOptionalParams(
  schema: InputSchema,
  optionalProperties: Record<string, Record<string, unknown>>
): InputSchema {
  return {
    type: "object",
    properties: { ...schema.properties, ...optionalProperties },
    required: schema.required
  };
}

/**
 * Flat argument name to the JSON:API pagination parameter it is sent as. Flat names keep the tool
 * schema readable — a model fills `page_size`, not `page[size]`.
 */
const PAGE_PARAM_NAMES: Record<string, string> = {
  page_number: "page[number]",
  page_size: "page[size]"
};

const PAGINATION_PARAMS = ["page_number", "page_size"] as const;

/*
 * `maximum` mirrors the API's maximum page size, so an over-large page
 * is rejected by the schema here rather than by a 400 from the API.
 */
const PAGINATION_PROPERTIES: Record<string, Record<string, unknown>> = {
  page_number: {
    type: "integer",
    minimum: 1,
    description:
      "Optional. Which page to return, counting from 1. Omit along with page_size to get the whole collection in one response."
  },
  page_size: {
    type: "integer",
    minimum: 1,
    maximum: 1000,
    description:
      "Optional. How many records per page. Omit along with page_number to get the whole collection in one response."
  }
};

const CAMPAIGN_FILTER_PARAMS = ["launched", "title_contains"] as const;

const CAMPAIGN_FILTER_PROPERTIES: Record<string, Record<string, unknown>> = {
  launched: {
    type: "boolean",
    description:
      "Optional. True returns only campaigns that have been launched, false only those never launched. Omit for both. On a mature account most campaigns have never launched, so this is usually the fastest way to a useful answer."
  },
  title_contains: {
    type: "string",
    description:
      "Optional. Return only campaigns whose title contains this string, case-insensitive. Use it to find a campaign by name instead of listing the account and searching the response."
  }
};

const DATE_FILTER_PARAMS = ["start_date", "end_date"] as const;

const DATE_FILTER_PROPERTIES: Record<string, Record<string, unknown>> = {
  start_date: {
    type: "string",
    description:
      "Optional. Only count activity on or after this date, as ISO 8601 (YYYY-MM-DD). Omit for all time."
  },
  end_date: {
    type: "string",
    description:
      "Optional. Only count activity on or before this date, as ISO 8601 (YYYY-MM-DD). Omit for all time."
  }
};

/*
 * Every tool here is a GET. If a write tool is ever added, it needs a safety layer first -
 * dry-run previews, batch caps, and confirmation on anything destructive - which this connector
 * deliberately does not have.
 */

/*
 * /api/v1/campaigns and /api/v1/campaign_stats now paginate on request, via the API's
 * optional paginator: no `page` param returns the whole collection exactly as before, so existing
 * consumers are unaffected, while `page[number]`/`page[size]` fetch a slice. Campaigns also filter
 * server-side on `launched` and `title_contains`.
 *
 * That is what makes src/truncate.ts a backstop rather than a dead end — a capped response can now
 * name the way to get the rest, and a narrow question can avoid the cap entirely instead of
 * transferring the account to answer it.
 *
 * The remaining collections (integrations, uploaders, traits) neither paginate nor filter. They
 * are small — dozens of records on a real account — so the cap does not bite. Revisit if one grows.
 */

export const GET_SELF: JebbitTool = {
  annotations: readAnnotations("Get account"),
  description: [
    "Get the Jebbit business the current API credentials authenticate as.",
    "Call this to confirm which business the connector is operating against,",
    "or when the user asks whose account this is."
  ].join(" "),
  inputSchema: NO_ARGUMENTS,
  method: "GET",
  name: "getSelf",
  path: "/api/v1/self",
  requiredScopes: [READ_BUSINESS_SCOPE]
};

export const GET_ALL_CAMPAIGNS: JebbitTool = {
  annotations: readAnnotations("List campaigns"),
  description: [
    "List all campaigns belonging to the authenticated Jebbit business.",
    "Each campaign includes its public id, title, launch date (null if never launched), active",
    "iteration, and how many integrations and scheduled exports reach it — split into those",
    "attached directly and those inherited brand-wide.",
    "Call this when the user asks which campaigns exist, wants to find a campaign by name,",
    "needs a campaign's public id for a follow-up call, or asks what is currently launched.",
    "Prefer narrowing over listing everything: pass title_contains to find a campaign by name, or",
    "launched to separate live campaigns from drafts. A large account holds thousands of campaigns",
    "and most have never launched, so an unfiltered call spends most of its budget on drafts.",
    "Use page_number and page_size to walk a large collection deliberately.",
    "Large accounts are capped: check meta.jebbit_mcp_truncation in the response and cite its",
    "total rather than counting the records if it is present."
  ].join(" "),
  filterParams: CAMPAIGN_FILTER_PARAMS,
  inputSchema: withOptionalParams(NO_ARGUMENTS, {
    ...CAMPAIGN_FILTER_PROPERTIES,
    ...PAGINATION_PROPERTIES
  }),
  method: "GET",
  name: "getAllCampaigns",
  pageParams: PAGINATION_PARAMS,
  path: "/api/v1/campaigns",
  requiredScopes: [READ_CAMPAIGN_SCOPE],
  truncationRecovery:
    "To see more, narrow with title_contains or launched, or request the next page with page_number and page_size."
};

export const GET_ONE_CAMPAIGN: JebbitTool = {
  annotations: readAnnotations("Get campaign"),
  description: [
    "Get a single Jebbit campaign by its public id, including title, launch date, and active iteration.",
    "Call this when the user names or has already identified one specific campaign.",
    "Use getAllCampaigns first if you need to resolve a campaign name to its public id.",
    "This returns campaign metadata only — for performance data call getOneCampaignStats."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/campaigns/{campaign_id}", {
    campaign_id: "The public id of the campaign, e.g. abc123. Obtain it from getAllCampaigns."
  }),
  method: "GET",
  name: "getOneCampaign",
  path: "/api/v1/campaigns/{campaign_id}",
  requiredScopes: [READ_CAMPAIGN_SCOPE]
};

export const GET_CAMPAIGN_LAUNCH_LINKS: JebbitTool = {
  annotations: readAnnotations("List a campaign's launch links"),
  description: [
    "List the launch links for a Jebbit campaign — the trackable URLs used to distribute it",
    "across channels such as email, social, and owned web.",
    "Each link includes its label, distribution channel grouping, URL parameters,",
    "whether it is currently enabled, and when it was created.",
    "Call this when the user asks how a campaign is being distributed, which channels it runs on,",
    "or wants the tracking links for a campaign."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/campaigns/{campaign_id}/launch_links", {
    campaign_id: "The public id of the campaign whose launch links to retrieve, e.g. abc123."
  }),
  method: "GET",
  name: "getCampaignLaunchLinks",
  path: "/api/v1/campaigns/{campaign_id}/launch_links",
  requiredScopes: [READ_LAUNCH_LINK_SCOPE]
};

export const GET_ALL_CAMPAIGN_STATS: JebbitTool = {
  annotations: readAnnotations("List campaign performance"),
  description: [
    "List performance metrics for every campaign in the authenticated Jebbit business.",
    "Each campaign reports views, loads, engagements, completions, leads, redirects, opt-ins,",
    "responses, outcome views, total time spent in seconds, and the derived engagement,",
    "completion, and lead rates as percentages.",
    "Call this when the user asks how campaigns are performing, which campaign performs best,",
    "or wants completion or engagement numbers across an account.",
    "Totals only — this does NOT include the outcome distribution or per-question drop-off. Use it",
    "to find the campaign worth looking at, then call getOneCampaignStats for that campaign's",
    "breakdown.",
    "Optionally pass start_date and end_date to restrict the totals to a date range. Note that a",
    "date range changes what the numbers are summed over, not which campaigns come back — every",
    "campaign is still listed, reporting zeros if it saw no activity in the window.",
    "Each row carries the campaign's title, so it can be read without a second call to getAllCampaigns.",
    "Use page_number and page_size to walk a large collection deliberately.",
    "Large accounts are capped: check meta.jebbit_mcp_truncation in the response and cite its",
    "total rather than counting the records if it is present."
  ].join(" "),
  filterParams: DATE_FILTER_PARAMS,
  inputSchema: withOptionalParams(NO_ARGUMENTS, {
    ...DATE_FILTER_PROPERTIES,
    ...PAGINATION_PROPERTIES
  }),
  method: "GET",
  name: "getAllCampaignStats",
  pageParams: PAGINATION_PARAMS,
  path: "/api/v1/campaign_stats",
  requiredScopes: [READ_CAMPAIGN_STAT_SCOPE],
  truncationRecovery:
    "To see more, request the next page with page_number and page_size, or use getAllCampaigns with title_contains to find the campaign you want and call getOneCampaignStats for it."
};

export const GET_ONE_CAMPAIGN_STATS: JebbitTool = {
  annotations: readAnnotations("Get campaign performance"),
  description: [
    "Get performance metrics for one Jebbit campaign by its public id — views, loads,",
    "engagements, completions, leads, redirects, opt-ins, responses, outcome views,",
    "time spent, and the derived engagement, completion, and lead rates.",
    "Call this when the user asks how one named campaign is doing; prefer it over",
    "getAllCampaignStats in that case, which returns every campaign in the account.",
    "Use getAllCampaigns first if you need to resolve a campaign name to its public id.",
    "Also returns which outcome respondents were shown and how often, and per-question drop-off —",
    "so it can answer which recommendation is most common and where a campaign loses people.",
    "It is the only tool that returns those two breakdowns; getAllCampaignStats omits them.",
    "Check each question row's resource_type before calling a low response_rate a drop-off: rows",
    "with a type of Outcome, Reward, ProductCatalog or ContentCollection are screens rather than",
    "questions, so a low rate there means people saw their result and did not click a call to",
    "action, which is normal and not a place the campaign is losing people.",
    "Optionally pass start_date and end_date to restrict the totals to a date range."
  ].join(" "),
  filterParams: DATE_FILTER_PARAMS,
  inputSchema: withOptionalParams(
    pathParamSchema("/api/v1/campaign_stats/{campaign_id}", {
      campaign_id: "The public id of the campaign, e.g. abc123. Obtain it from getAllCampaigns."
    }),
    DATE_FILTER_PROPERTIES
  ),
  method: "GET",
  name: "getOneCampaignStats",
  path: "/api/v1/campaign_stats/{campaign_id}",
  requiredScopes: [READ_CAMPAIGN_STAT_SCOPE]
};

export const GET_ALL_INTEGRATIONS: JebbitTool = {
  annotations: readAnnotations("List integrations"),
  description: [
    "List every integration configured for the authenticated Jebbit business, across all services.",
    "Each one includes its service name (klaviyo, braze, hubspot, webhook and so on), destination",
    "host, data processing region, opt-in requirement, whether it is active, whether it was created",
    "in the Jebbit dashboard, the field mappings applied on the way out (jebbit_var to client_var,",
    "with fallback value, data type and any transformers such as sha256), and the static values",
    "injected with the level each came from.",
    "Also says how each one is attached: brand-wide, to specific campaigns, or both.",
    "Call this when the user asks which integrations a client has, where campaign data is being",
    "sent, how a field is mapped or renamed for a destination, or wants to audit integration",
    "configuration.",
    "This is the complete inventory, including integrations not created in the dashboard, so it is",
    "the right tool for auditing webhooks too. Credentials are never included and",
    "destinations are reported as a host rather than a full URL."
  ].join(" "),
  inputSchema: NO_ARGUMENTS,
  method: "GET",
  name: "getAllIntegrations",
  path: "/api/v1/integrations",
  requiredScopes: [READ_INTEGRATION_SCOPE]
};

export const GET_ONE_INTEGRATION: JebbitTool = {
  annotations: readAnnotations("Get integration"),
  description: [
    "Get a single Jebbit integration by its public id, with its destination, mappings, static",
    "values and flow options.",
    "Call this when the user has identified one specific integration.",
    "Use getAllIntegrations first to resolve a service name to its public id."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/integrations/{integration_id}", {
    integration_id: "The public id of the integration, e.g. abc123. Obtain it from getAllIntegrations."
  }),
  method: "GET",
  name: "getOneIntegration",
  path: "/api/v1/integrations/{integration_id}",
  requiredScopes: [READ_INTEGRATION_SCOPE]
};

export const GET_CAMPAIGN_INTEGRATIONS: JebbitTool = {
  annotations: readAnnotations("List a campaign's integrations"),
  description: [
    "List the integrations attached directly to one Jebbit campaign, with their mappings and the",
    "static values that apply — resolved with this campaign's own values taking precedence, which",
    "is what makes this different from getAllIntegrations.",
    "Brand-wide integrations also fire for this campaign but are not returned here; the campaign's",
    "integration_counts from getAllCampaigns reports those as inherited.",
    "Call this when the user asks where one specific campaign's data goes, or why a value arrives",
    "the way it does for that campaign."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/campaigns/{campaign_id}/integrations", {
    campaign_id: "The public id of the campaign, e.g. abc123. Obtain it from getAllCampaigns."
  }),
  method: "GET",
  name: "getCampaignIntegrations",
  path: "/api/v1/campaigns/{campaign_id}/integrations",
  requiredScopes: [READ_INTEGRATION_SCOPE]
};

export const GET_INTEGRATION_CAMPAIGNS: JebbitTool = {
  annotations: readAnnotations("List an integration's campaigns"),
  description: [
    "List the campaigns explicitly linked to one Jebbit integration.",
    "Call this when the user asks which campaigns feed a particular destination.",
    "A brand-attached integration also fires for every other campaign in the account without",
    "appearing here — check the integration's attached_at field from getAllIntegrations, which",
    "reads brand when that is the case."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/integrations/{integration_id}/campaigns", {
    integration_id: "The public id of the integration, e.g. abc123. Obtain it from getAllIntegrations."
  }),
  method: "GET",
  name: "getIntegrationCampaigns",
  path: "/api/v1/integrations/{integration_id}/campaigns",
  requiredScopes: [READ_CAMPAIGN_SCOPE]
};

export const GET_ALL_UPLOADERS: JebbitTool = {
  annotations: readAnnotations("List scheduled exports"),
  description: [
    "List the scheduled exports configured for the authenticated Jebbit business — the batch",
    "counterpart to an integration, shipping session data on a cadence to SFTP, S3, Google Cloud",
    "Storage, Azure or email rather than firing per submission.",
    "Each includes its schedule (hourly, 8:00-daily, 2:00-weekly-tuesday and so on), output format,",
    "which fields are sent, the destination host or bucket, and the last ten runs with their status",
    "and row counts.",
    "Call this when the user asks about scheduled exports, data feeds out of Jebbit, or whether a",
    "nightly file delivery is still working.",
    "Credentials are never included, and an email destination reports how many recipients it has",
    "rather than the addresses."
  ].join(" "),
  inputSchema: NO_ARGUMENTS,
  method: "GET",
  name: "getAllUploaders",
  path: "/api/v1/uploaders",
  requiredScopes: [READ_UPLOADER_SCOPE]
};

export const GET_ONE_UPLOADER: JebbitTool = {
  annotations: readAnnotations("Get scheduled export"),
  description: [
    "Get a single Jebbit scheduled export by its public id — its cadence, format, field selection,",
    "destination and recent run history.",
    "Call this when the user has identified one specific export, or asks whether a named export",
    "ran successfully.",
    "Use getAllUploaders first to resolve a name to its public id."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/uploaders/{uploader_id}", {
    uploader_id: "The public id of the scheduled export, e.g. upl123. Obtain it from getAllUploaders."
  }),
  method: "GET",
  name: "getOneUploader",
  path: "/api/v1/uploaders/{uploader_id}",
  requiredScopes: [READ_UPLOADER_SCOPE]
};

export const GET_CAMPAIGN_UPLOADERS: JebbitTool = {
  annotations: readAnnotations("List a campaign's scheduled exports"),
  description: [
    "List the scheduled exports attached directly to one Jebbit campaign.",
    "Brand-wide exports also cover this campaign but are not returned here; the campaign's",
    "uploader_counts from getAllCampaigns reports those as inherited.",
    "Call this when the user asks which exports include a particular campaign's data."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/campaigns/{campaign_id}/uploaders", {
    campaign_id: "The public id of the campaign, e.g. abc123. Obtain it from getAllCampaigns."
  }),
  method: "GET",
  name: "getCampaignUploaders",
  path: "/api/v1/campaigns/{campaign_id}/uploaders",
  requiredScopes: [READ_UPLOADER_SCOPE]
};

export const GET_UPLOADER_CAMPAIGNS: JebbitTool = {
  annotations: readAnnotations("List a scheduled export's campaigns"),
  description: [
    "List the campaigns explicitly linked to one Jebbit scheduled export.",
    "Call this when the user asks whose data a particular export contains.",
    "A brand-attached export also covers every other campaign in the account without appearing",
    "here — check its attached_at field from getAllUploaders, which reads brand when that is",
    "the case."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/uploaders/{uploader_id}/campaigns", {
    uploader_id: "The public id of the scheduled export, e.g. upl123. Obtain it from getAllUploaders."
  }),
  method: "GET",
  name: "getUploaderCampaigns",
  path: "/api/v1/uploaders/{uploader_id}/campaigns",
  requiredScopes: [READ_CAMPAIGN_SCOPE]
};

const TRAIT_FILTER_PARAMS = ["user_defined_id"] as const;

const TRAIT_FILTER_PROPERTIES: Record<string, Record<string, unknown>> = {
  user_defined_id: {
    type: "string",
    description:
      "Optional. Return only the attributes with these user_defined_ids, comma-separated for several " +
      "(e.g. skin_concern,email). This is the cheap way to resolve a mapping's jebbit_var. Unmatched " +
      "ids are ignored rather than erroring."
  }
};

export const GET_ALL_TRAITS: JebbitTool = {
  annotations: readAnnotations("List attributes"),
  description: [
    "List the attributes the authenticated Jebbit business collects — what the Jebbit dashboard",
    "calls Attributes and the data model calls traits.",
    "Each includes its user_defined_id, display name, rank, and whether it passes to integrations.",
    "Call this when the user asks what data a client captures or what attributes exist.",
    "To resolve which attribute an integration mapping reads, do NOT list everything: pass the",
    "mapping's jebbit_var values as user_defined_id, comma-separated. A brand can hold hundreds of",
    "attributes and a mapping only ever refers to a handful.",
    "Use page_number and page_size to walk the full set deliberately.",
    "Large accounts are capped: check meta.jebbit_mcp_truncation in the response and cite its",
    "total rather than counting the records if it is present."
  ].join(" "),
  filterParams: TRAIT_FILTER_PARAMS,
  inputSchema: withOptionalParams(NO_ARGUMENTS, {
    ...TRAIT_FILTER_PROPERTIES,
    ...PAGINATION_PROPERTIES
  }),
  method: "GET",
  name: "getAllTraits",
  pageParams: PAGINATION_PARAMS,
  path: "/api/v1/traits",
  requiredScopes: [READ_TRAIT_SCOPE],
  truncationRecovery:
    "To resolve a specific attribute, pass its user_defined_id rather than listing them all. To see more of the full set, request the next page with page_number and page_size."
};

export const GET_ONE_TRAIT: JebbitTool = {
  annotations: readAnnotations("Get attribute"),
  description: [
    "Get a single Jebbit attribute by its public id.",
    "Call this when the user has identified one specific attribute.",
    "Use getAllTraits first to resolve a name to its public id."
  ].join(" "),
  inputSchema: pathParamSchema("/api/v1/traits/{trait_id}", {
    trait_id: "The public id of the attribute, e.g. trt123. Obtain it from getAllTraits."
  }),
  method: "GET",
  name: "getOneTrait",
  path: "/api/v1/traits/{trait_id}",
  requiredScopes: [READ_TRAIT_SCOPE]
};

export const TOOLS: readonly JebbitTool[] = [
  GET_SELF,
  GET_ALL_CAMPAIGNS,
  GET_ONE_CAMPAIGN,
  GET_CAMPAIGN_LAUNCH_LINKS,
  GET_ALL_CAMPAIGN_STATS,
  GET_ONE_CAMPAIGN_STATS,
  GET_ALL_INTEGRATIONS,
  GET_ONE_INTEGRATION,
  GET_CAMPAIGN_INTEGRATIONS,
  GET_INTEGRATION_CAMPAIGNS,
  GET_ALL_UPLOADERS,
  GET_ONE_UPLOADER,
  GET_CAMPAIGN_UPLOADERS,
  GET_UPLOADER_CAMPAIGNS,
  GET_ALL_TRAITS,
  GET_ONE_TRAIT
];

/**
 * The query string name for a tool argument. JSON:API filters are nested — the API reads
 * `params[:filter][:start_date]`, and the API rejects a bare `start_date` as an
 * unknown parameter — but the tool schema keeps flat names because those are easier for a
 * model to fill in correctly.
 */
export function queryParamName(tool: JebbitTool, argumentName: string): string {
  if (tool.filterParams?.includes(argumentName)) {
    return `filter[${argumentName}]`;
  }

  if (tool.pageParams?.includes(argumentName)) {
    return PAGE_PARAM_NAMES[argumentName] ?? argumentName;
  }

  return argumentName;
}

export function findTool(name: string): JebbitTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
