# Jebbit MCP

A local MCP server for Jebbit (Experiences by BlueConic), packaged as a Claude Desktop `.mcpb`
connector and as a stdio server for other MCP clients.

Ask about your campaigns in plain language: how they performed, which recommendation respondents
saw most, where people dropped off, where campaign data is being sent, and whether a scheduled
export is still running.

## Security

- **Read-only.** Every tool is a GET. Nothing can be created, changed or deleted.
- **No credentials are ever returned.** Integration and export secrets are not read. Destinations
  are reported as a host rather than a full endpoint, because endpoints routinely carry tokens in
  the path or query string. An email export reports how many recipients it has, not the addresses.
- **No individual respondents.** There is no access to individual submissions or to the answers a
  particular person gave. All reporting is aggregate counts.
- **Credentials stay on the machine running the server.** They are sent only to Jebbit's Auth0
  tenant and API.

## Quick Start

```bash
npm install
npm run pack:mcpb
```

Install `dist/jebbit-mcp-<version>.mcpb` via Claude Desktop → Settings → Connectors → Advanced
settings → Install extension, then open **Configure** and enter the Client ID and Client Secret
issued for your brand. Reinstall after each rebuild; Claude Desktop caches the bundle.

For other MCP clients:

```bash
claude mcp add jebbit \
  -e JEBBIT_CLIENT_ID=... \
  -e JEBBIT_CLIENT_SECRET=... \
  -- npx tsx /path/to/jebbit-mcp/src/client-side-server.ts
```

## Tools

All target the documented JSON:API surface at `https://api2.jebbit.com`. Every tool also accepts an
optional `business_id` — see [Choosing a brand](#choosing-a-brand).

| Tool | Path | Scope | Args |
|---|---|---|---|
| `getSelf` | `/api/v1/self` | `read:business` | — |
| `getAllCampaigns` | `/api/v1/campaigns` | `read:campaign` | `launched`?, `title_contains`?, `page_number`?, `page_size`? |
| `getOneCampaign` | `/api/v1/campaigns/{campaign_id}` | `read:campaign` | `campaign_id` |
| `getCampaignLaunchLinks` | `/api/v1/campaigns/{campaign_id}/launch_links` | `read:launch_link` | `campaign_id` |
| `getAllCampaignStats` | `/api/v1/campaign_stats` | `read:campaign_stat` | `start_date`?, `end_date`?, `page_number`?, `page_size`? |
| `getOneCampaignStats` | `/api/v1/campaign_stats/{campaign_id}` | `read:campaign_stat` | `campaign_id`, `start_date`?, `end_date`? |
| `getAllIntegrations` | `/api/v1/integrations` | `read:integration` | — |
| `getOneIntegration` | `/api/v1/integrations/{integration_id}` | `read:integration` | `integration_id` |
| `getCampaignIntegrations` | `/api/v1/campaigns/{campaign_id}/integrations` | `read:integration` | `campaign_id` |
| `getIntegrationCampaigns` | `/api/v1/integrations/{integration_id}/campaigns` | `read:campaign` | `integration_id` |
| `getAllUploaders` | `/api/v1/uploaders` | `read:uploader` | — |
| `getOneUploader` | `/api/v1/uploaders/{uploader_id}` | `read:uploader` | `uploader_id` |
| `getCampaignUploaders` | `/api/v1/campaigns/{campaign_id}/uploaders` | `read:uploader` | `campaign_id` |
| `getUploaderCampaigns` | `/api/v1/uploaders/{uploader_id}/campaigns` | `read:campaign` | `uploader_id` |
| `getAllTraits` | `/api/v1/traits` | `read:trait` | `user_defined_id`?, `page_number`?, `page_size`? |
| `getOneTrait` | `/api/v1/traits/{trait_id}` | `read:trait` | `trait_id` |

Scopes are the **singular** resource name the API checks — `read:campaign`, not `read:campaigns`.
Pluralizing returns 403, and `getSelf` needs `read:business`, not `read:self`.

A nested route is gated by the scope of what it **returns**, not what is in the path:
`/campaigns/{id}/uploaders` needs `read:uploader`, while `/uploaders/{id}/campaigns` needs
`read:campaign`.

`read:campaign_stat`, `read:uploader` and `read:trait` must be granted to the credential before a
token can carry them. Grants do not backfill when a permission is added, so an existing credential
may need updating.

## Behaviour

### Choosing a brand

A credential scoped to a single brand needs nothing — the API resolves it from the token. One
covering several brands must say which on every request, or it returns 401. Pass `business_id` on
the call, or set a default via `JEBBIT_BUSINESS_ID`; a value on the call wins. When a multi-brand
credential omits it, the error names the brands the token grants so the call can be retried.

### Narrowing a collection

`getAllCampaigns` takes `launched` and `title_contains`. `getAllTraits` takes `user_defined_id`,
comma-separated for several — an integration mapping's `jebbit_var` holds a trait's
`user_defined_id`, so resolving one costs a handful of records rather than the whole attribute set.
`getAllCampaignStats` and `getOneCampaignStats` take `start_date` / `end_date` as `YYYY-MM-DD`.

A date range changes *what the numbers are summed over*, not *which campaigns come back* — every
campaign is still listed, reporting zeros if it saw no activity.

### Paging and response size

`getAllCampaigns`, `getAllCampaignStats` and `getAllTraits` take `page_number` (from 1) and
`page_size` (max 1000). Omitting both returns the whole collection, which is the API's original
contract.

Collections are also capped client-side, because an unparameterised call on a large account can
exceed a context window. The cap is announced rather than applied silently — the response carries
the true total under `meta.jebbit_mcp_truncation` along with how to ask for the rest, so a partial
result is never mistaken for a complete one.

### Reading the numbers

Responses are flattened out of the JSON:API envelope: `attributes` are hoisted onto the record and
the per-record `type` is reported once as `meta.jebbit_mcp_record_type`.

`getOneCampaignStats` returns outcome distribution and per-question drop-off; `getAllCampaignStats`
returns totals only. Two things about the drop-off figures:

- Rows cover every screen a respondent interacts with, not only questions. Each carries a
  `resource_type`; on an `Outcome` or `Reward` screen a low response rate means people saw their
  result and did not click through, which is normal rather than a loss.
- Questions and outcomes are identified by name and merged across campaign versions, so editing a
  campaign does not split one question into a row per version.

## Authentication

OAuth 2.0 client credentials against Jebbit's Auth0 tenant. The Client ID and Client Secret are
issued per brand — contact your account team if you do not have them.

### Environment variables

| Variable | Required | Default |
|---|---|---|
| `JEBBIT_CLIENT_ID` | yes | — |
| `JEBBIT_CLIENT_SECRET` | yes | — |
| `JEBBIT_BUSINESS_ID` | no | inferred from the token when it covers one brand |
| `JEBBIT_API_BASE_URL` | no | `https://api2.jebbit.com` |
| `JEBBIT_AUTH_ISSUER` | no | `https://auth.jebbit.com` |
| `JEBBIT_API_AUDIENCE` | no | `public-api` |

`http://` survives only for `localhost`, `127.0.0.1` and `[::1]`; every other host is upgraded to
https. That exemption exists so the server can be run against a local backend, and it is a fixed
host list rather than a flag, so nothing can switch it on in production.

## Project Layout

```text
src/
  client-side-server.ts    # MCP server entry point + tool dispatch
  tools.ts                 # hand-written tool registry
  api-client.ts            # JSON:API request/response handling, path templating
  arguments.ts             # splits tool arguments into path, query and the brand header
  flatten.ts               # hoists JSON:API attributes to plain objects
  truncate.ts              # caps oversized collections, announcing what it dropped
  auth.ts                  # Auth0 client-credentials flow + scoped token cache
  config.ts                # env var reading, URL normalization
  errors.ts                # typed errors + sanitized client-facing messages
  http.ts                  # 30s-timeout fetch wrapper
  __tests__/
scripts/
  build-mcpb.mjs           # esbuild single-file bundle -> server/index.mjs
  pack-mcpb.mjs            # wraps the bundle into dist/jebbit-mcp-<version>.mcpb
  check-mcpb-bundle.mjs    # packaging regression guard
  clean-dist.mjs
manifest.json              # Claude Desktop connector manifest
.mcpbignore
```

## Development

```bash
npm test
npm run lint
npm run validate:mcpb
npm run pack:mcpb
```

`pack:mcpb` calls the `mcpb` binary from `node_modules/.bin`, so run it through npm rather than
invoking `scripts/pack-mcpb.mjs` directly.
