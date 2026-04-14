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
};

export function getComposioProvider(id: string) {
  const p = COMPOSIO_PROVIDERS[id];
  if (!p) return null;
  const authConfigId = process.env[p.authConfigEnv];
  if (!authConfigId) return null;
  return { toolkit: p.toolkit, authConfigId };
}
