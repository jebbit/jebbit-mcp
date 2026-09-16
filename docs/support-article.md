# Experiences by BlueConic — Claude connector

Published at https://support-experiences.blueconic.com/en/articles/830025-experiences-by-blueconic-claude-connector
and set as the connector's `documentation` field. Keep the two in step when editing.

---

Connect Claude to your Experiences account and ask about your campaigns in plain language: how they
performed, which recommendation respondents saw most, where people dropped off, where campaign data
is being sent, and whether a scheduled export is still running.

The connector is read-only. It cannot create, change or delete anything in your account.

> **Before you share data with an AI assistant**, check your organisation's policy. Claude will see
> the campaign names, performance figures and integration configuration it retrieves in order to
> answer your question.

## Before you begin

You need:

- An active Experiences account.
- API credentials — a Client ID and Client Secret. Contact your account team if you do not have
  them; they are issued per brand.
- Claude Desktop.

If your credentials cover more than one brand, have the Business IDs to hand. You can set one as
the default during setup and still ask about the others by name.

## Install the connector

1. Download the connector file (`.mcpb`) from the Claude connector directory, or from the link your
   account team provided.
2. Open Claude Desktop and go to **Settings → Connectors**.
3. Install the connector and open **Configure**.
4. Enter your **OAuth Client ID** and **OAuth Client Secret**. Set a **Default Business ID** if
   your credentials cover more than one brand.
5. Save.

Your credentials are stored on your own machine and are sent only to Experiences. They are not
shared with Anthropic and are not visible to anyone else.

## What you can ask

The connector gives Claude sixteen read-only tools across five areas.

**Campaigns** — list them, find one by name, and get its launch links and distribution channels.

**Performance** — views, engagements, completions, leads, opt-ins, time spent, and the derived
engagement, completion and lead rates, over all time or a date range you specify. Ask about a single
campaign and you also get which outcome respondents were shown and how often, and how many people
reached each question versus answered it.

**Integrations** — every integration configured for the brand, with the service it sends to, the
destination host, the field mappings applied on the way out, and any static values injected into the
payload.

**Scheduled exports** — the batch exports that ship session data on a cadence to SFTP, S3, Google
Cloud Storage, Azure or email, including their schedule, which fields they send, and the last ten
runs with row counts and status.

**Attributes** — the attributes your experiences collect, which is how a field name in an
integration mapping resolves to the attribute it reads.

Campaigns, integrations and exports cross-reference in both directions, so you can ask what a
campaign feeds and also which campaigns feed a given destination.

**Working across brands.** If your credentials cover several brands, you can ask about any of
them in the same conversation — say which brand you mean and Claude will scope the question to
it. The Default Business ID is only the brand assumed when you do not say.

## Example prompts

- *Which campaigns are live, and how are they performing this quarter?*
- *Where do people drop off in the Product Finder quiz?*
- *Which recommendation do respondents see most often?*
- *Where does this campaign's data go, and what fields are we sending?*
- *Is our nightly SFTP export still running, and how many rows did it send?*
- *Which attribute does the `skin_concern` mapping on our Klaviyo integration read?*

## Reading the results

Two things are worth knowing so you do not misread a number.

**Drop-off includes results screens.** The per-question breakdown covers every screen a respondent
interacts with, not only questions. Each row reports a `resource_type`. On an `Outcome` or `Reward`
screen, a low response rate means people saw their result and did not click a call to action, which
is normal rather than a place the campaign is losing people.

**Large accounts are summarised.** Where an account holds more records than fit in one answer, the
connector says so and reports the true total rather than quietly returning a subset. If Claude
mentions a partial result, ask it to narrow the question — by campaign name, by launched status, or
by a specific attribute — rather than asking for everything again.

## What the connector cannot do

- **It cannot change anything.** Every operation is a read.
- **It never returns credentials.** Integration and export secrets are not read at all. Destinations
  are reported as a host rather than a full endpoint, because endpoints often carry tokens. An email
  export reports how many recipients it has, not their addresses.
- **It does not expose individual respondents.** There is no access to individual submissions, to
  the answers a particular person gave, or to any personally identifiable data. All reporting is
  aggregate counts.

## Troubleshooting

**"Not authorized" or a permissions error.** Your credentials may not carry the scopes for what you
asked. Reporting, scheduled exports and attributes each need their own permission granted to your
credential. Email support@jebbit.com with the name of the tool that failed.

**"Not authorized" on everything, with multi-brand credentials.** When your credentials cover
more than one brand, every request has to say which one. Claude will tell you which brands your
credentials cover and ask you to pick. To stop being asked, set a Default Business ID in the
connector's configuration.

**Nothing comes back for a campaign you can see in the dashboard.** Check the Business ID matches
the brand that owns the campaign.
