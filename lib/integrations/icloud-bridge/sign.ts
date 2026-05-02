/**
 * HMAC signing for the iCloud Bridge.
 *
 * MUST byte-for-byte match the canonical form in
 *   templates/icloud-bridge/server.ts (expectedSig, canonicalQuery)
 *   templates/vps/custom-mcp-adapter.ts (bridgeSign)
 *
 * Form: `${METHOD} ${decoded(path)} ${sorted_query} ${body}`
 *   - decoded(path):  decodeURIComponent(url.pathname)
 *   - sorted_query:   keys sorted alphabetically; for each key, values sorted; pairs joined `key=value` with `&`
 *   - body:           empty string for GET/DELETE; JSON.stringify(body) for POST/PUT
 *   - separator:      single ASCII space, INCLUDING the trailing space before body even if body is ""
 *
 * If you change anything here, change all three in lockstep.
 */

import { createHmac } from "node:crypto";

function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: string[] = [];
  const keys = Array.from(searchParams.keys()).sort();
  for (const k of keys) {
    for (const v of searchParams.getAll(k).sort()) {
      pairs.push(`${k}=${v}`);
    }
  }
  return pairs.join("&");
}

export function bridgeSign(
  secret: string,
  method: string,
  urlString: string,
  body: string,
): string {
  const u = new URL(urlString);
  const decoded = decodeURIComponent(u.pathname);
  const q = canonicalQuery(u.searchParams);
  return createHmac("sha256", secret)
    .update(`${method} ${decoded} ${q} ${body}`)
    .digest("hex");
}
