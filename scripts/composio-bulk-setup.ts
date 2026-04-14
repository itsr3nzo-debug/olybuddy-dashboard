/**
 * One-shot script: create Composio managed auth configs for EVERY toolkit
 * that supports it. Writes the slug → auth-config-id map to
 * lib/composio-registry.json so the dashboard can look up auth configs
 * at runtime without needing 200 env vars.
 */
import { Composio } from "@composio/core";
import fs from "node:fs";
import path from "node:path";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

async function main() {
  console.log("Fetching all managed toolkits…");
  const all: any = await composio.toolkits.getToolkits({
    limit: 1000,
    managedBy: "composio",
  } as any);
  const toolkits = (all?.items ?? all ?? []) as any[];
  console.log(`Found ${toolkits.length} managed toolkits`);

  console.log("Fetching existing auth configs…");
  const existing = await composio.authConfigs.list({ limit: 500 } as any);
  const existingBySlug = new Map<string, string>();
  for (const cfg of (existing as any).items ?? []) {
    const slug = (cfg.toolkit?.slug || "").toLowerCase();
    if (slug && !existingBySlug.has(slug)) {
      existingBySlug.set(slug, cfg.id);
    }
  }
  console.log(`Already have ${existingBySlug.size} auth configs`);

  const registry: Record<
    string,
    { authConfigId: string; name: string; categories: string[] }
  > = {};
  let created = 0, skipped = 0, failed = 0;

  for (const t of toolkits) {
    const slug = t.slug || t.id;
    const name = t.name || slug;
    const categories = (t.meta?.categories || []).map(
      (c: any) => c.id || c.name || c,
    );

    if (existingBySlug.has(slug)) {
      registry[slug] = {
        authConfigId: existingBySlug.get(slug)!,
        name,
        categories,
      };
      skipped++;
      continue;
    }

    try {
      const r = await composio.authConfigs.create(slug, {
        type: "use_composio_managed_auth",
        name: `${slug}-nexley`,
      } as any);
      registry[slug] = { authConfigId: r.id, name, categories };
      created++;
      if (created % 10 === 0) console.log(`  … ${created} created`);
    } catch (e: any) {
      const msg = (e?.message || "").slice(0, 80);
      failed++;
      if (failed <= 5) console.log(`  [fail] ${slug}: ${msg}`);
    }
  }

  const outPath = path.join(
    __dirname,
    "..",
    "lib",
    "composio-registry.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(registry, null, 2));
  console.log(`\n✅ Wrote ${Object.keys(registry).length} entries to ${outPath}`);
  console.log(`   created: ${created}  reused: ${skipped}  failed: ${failed}`);
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(1);
});
