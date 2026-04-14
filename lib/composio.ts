import { Composio } from "@composio/core";
import registry from "./composio-registry.json";

export const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY!,
});

type RegistryEntry = {
  authConfigId: string;
  name: string;
  categories: string[];
};

const REGISTRY = registry as Record<string, RegistryEntry>;

/**
 * Map from dashboard provider ID → Composio toolkit slug.
 * Most provider IDs map 1:1 to toolkit slugs. Use this table only for
 * mismatches (e.g. dashboard uses `google_calendar`, Composio uses `googlecalendar`).
 */
const PROVIDER_TO_TOOLKIT_OVERRIDES: Record<string, string> = {
  google_calendar: "googlecalendar",
  google_drive: "googledrive",
};

export function getComposioProvider(providerId: string) {
  const toolkitSlug =
    PROVIDER_TO_TOOLKIT_OVERRIDES[providerId] || providerId;
  const entry = REGISTRY[toolkitSlug];
  if (!entry) return null;
  return { toolkit: toolkitSlug, authConfigId: entry.authConfigId };
}

/** All Composio toolkit slugs we have auth configs for (118 of them). */
export function getAllComposioToolkits(): string[] {
  return Object.keys(REGISTRY);
}

/** Registry entry for a toolkit (categories, display name). */
export function getComposioToolkit(slug: string): RegistryEntry | null {
  return REGISTRY[slug] ?? null;
}
