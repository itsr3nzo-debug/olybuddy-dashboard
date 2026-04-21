import { Composio } from "@composio/core";
import registry from "./composio-registry.json";

// Lazy init — instantiating at module scope throws during next build's
// "collect page data" step when COMPOSIO_API_KEY isn't set (e.g. in CI,
// or any env without the integration configured).
let _composio: Composio | null = null;
function getClient(): Composio {
  if (!_composio) {
    _composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
  }
  return _composio;
}

// Proxy that forwards all property access to the lazily-created client.
// Keeps the existing `composio.connectedAccounts.initiate(...)` call sites
// working unchanged while deferring the SDK constructor until first use.
export const composio = new Proxy({} as Composio, {
  get(_t, prop: string | symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getClient() as any)[prop];
  },
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
