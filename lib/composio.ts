import { Composio } from "@composio/core";

export const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY!,
});

// Map dashboard provider IDs → Composio toolkit slugs + auth config env vars
export const COMPOSIO_PROVIDERS: Record<
  string,
  { toolkit: string; authConfigEnv: string }
> = {
  gmail: { toolkit: "gmail", authConfigEnv: "COMPOSIO_AUTH_CONFIG_GMAIL" },
  google_calendar: {
    toolkit: "googlecalendar",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR",
  },
  slack: { toolkit: "slack", authConfigEnv: "COMPOSIO_AUTH_CONFIG_SLACK" },
  hubspot: {
    toolkit: "hubspot",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_HUBSPOT",
  },
  quickbooks: {
    toolkit: "quickbooks",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_QUICKBOOKS",
  },
  calendly: {
    toolkit: "calendly",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_CALENDLY",
  },
  google_drive: {
    toolkit: "googledrive",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_GOOGLE_DRIVE",
  },
  outlook: {
    toolkit: "outlook",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_OUTLOOK",
  },
  microsoft_teams: {
    toolkit: "microsoft_teams",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_MICROSOFT_TEAMS",
  },
  sage: {
    toolkit: "sage",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_SAGE",
  },
  freeagent: {
    toolkit: "freeagent",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_FREEAGENT",
  },
  fathom: {
    toolkit: "fathom",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_FATHOM",
  },
  stripe: {
    toolkit: "stripe",
    authConfigEnv: "COMPOSIO_AUTH_CONFIG_STRIPE",
  },
};

export function getComposioProvider(id: string) {
  const p = COMPOSIO_PROVIDERS[id];
  if (!p) return null;
  const authConfigId = process.env[p.authConfigEnv];
  if (!authConfigId) return null;
  return { toolkit: p.toolkit, authConfigId };
}
