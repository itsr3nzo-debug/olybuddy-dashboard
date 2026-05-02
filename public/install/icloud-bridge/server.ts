#!/usr/bin/env bun
/**
 * Nexley iCloud Bridge — runs on a client's Mac that's signed into their
 * Apple ID. Exposes iCloud Drive, Photos, Notes, and Shortcuts via
 * authenticated REST over Tailscale.
 *
 * Why: Apple has no public API for Drive/Photos/Notes/iWork. Reverse-
 * engineered libs (pyicloud, rclone-iCloud) all use the user's real Apple
 * ID password + SRP — operationally toxic at scale (30-day trust token,
 * Apple breaks SRP ~2x/year, TOS-violating). This bridge sidesteps
 * everything: macOS handles iCloud auth natively, Apple's `bird` daemon
 * syncs files locally, our service never sees a password.
 *
 * Security model:
 *   - Listens on tailnet only — invisible from public internet
 *   - HMAC-SHA256 over `METHOD + ' ' + DECODED_PATH + ' ' + DECODED_QUERY + ' ' + BODY`
 *     (canonical form — both sides decode before signing to avoid percent-encoding drift)
 *   - timing-safe signature compare
 *   - realpath check on every Drive op to defeat symlink escapes
 *   - All shell exec uses execFile (argv array, no shell) — no command injection
 *   - AppleScript built as data files in a per-request tempdir, never interpolated
 *   - Secret loaded from disk on EVERY request — rotation is just an atomic writeFile
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import {
  readdir, readFile, writeFile, mkdir, stat, unlink, realpath, rm,
} from 'node:fs/promises';
import { existsSync, createReadStream, statSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFile as execFileCb, exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const execShell = promisify(execCb);

// Secret from disk every request (DA-required: rotation = atomic file write).
const SECRET_FILE = process.env.NEXLEY_BRIDGE_SECRET_FILE
  ?? join(homedir(), '.nexley-bridge', 'secret');

// On boot, fail fast if no readable secret.
function readSecret(): string {
  try {
    const s = require('node:fs').readFileSync(SECRET_FILE, 'utf8').trim();
    if (s.length < 32) throw new Error(`secret too short: ${s.length} chars`);
    return s;
  } catch (e) {
    console.error(`[bridge] FATAL: cannot read secret from ${SECRET_FILE}: ${e}`);
    process.exit(1);
  }
}

readSecret();   // boot-time validation; per-request reads happen in middleware

const PORT = Number(process.env.NEXLEY_BRIDGE_PORT ?? 7878);
// SECURITY: bind to tailscale0 IP only (not 0.0.0.0). Otherwise the bridge is
// reachable from the LAN — anyone on office Wi-Fi could brute-force HMAC.
// install.sh detects tailnet IP at install time and writes it into the plist as
// NEXLEY_BRIDGE_HOST. If the env var isn't set, fall back to runtime detection
// across known tailscale binary paths, then refuse to bind to 0.0.0.0.
async function detectTailscaleIp(): Promise<string | null> {
  for (const bin of ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale', 'tailscale']) {
    try {
      const { stdout } = await execFile(bin, ['ip', '-4']);
      const ip = stdout.trim().split('\n')[0]?.trim();
      if (ip && /^100\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* try next */ }
  }
  return null;
}

let HOST: string;
if (process.env.NEXLEY_BRIDGE_HOST) {
  HOST = process.env.NEXLEY_BRIDGE_HOST;
} else {
  const ts = await detectTailscaleIp();
  if (!ts) {
    console.error('[bridge] FATAL: tailscale IP not detectable AND NEXLEY_BRIDGE_HOST not set. Refusing to bind to 0.0.0.0 (would expose to LAN).');
    process.exit(1);
  }
  HOST = ts;
}
const ICLOUD_ROOT = process.env.NEXLEY_BRIDGE_ICLOUD_DIR
  ?? join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
const MAX_UPLOAD_BYTES = Number(process.env.NEXLEY_BRIDGE_MAX_UPLOAD ?? 50_000_000); // 50MB

let ICLOUD_ROOT_REAL = ICLOUD_ROOT;
try { ICLOUD_ROOT_REAL = await realpath(ICLOUD_ROOT); } catch { /* may not exist yet */ }

// ────────────────────────────────────────────────────────────────────────────
// HMAC — canonical signing form: METHOD + ' ' + DECODED_PATH + ' ' + SORTED_QUERY + ' ' + BODY
// Both sides decode percent-encoding and sort query params alphabetically before signing,
// so URL normalisation differences (Hono path-decoding, encodeURIComponent casing, etc) don't
// produce divergent signatures.
// ────────────────────────────────────────────────────────────────────────────

function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: string[] = [];
  const keys = Array.from(searchParams.keys()).sort();
  for (const k of keys) {
    for (const v of searchParams.getAll(k).sort()) {
      pairs.push(`${k}=${v}`);
    }
  }
  return pairs.join('&');
}

function expectedSig(secret: string, method: string, urlString: string, body: string): string {
  const u = new URL(urlString);
  const decoded = decodeURIComponent(u.pathname);
  const q = canonicalQuery(u.searchParams);
  return createHmac('sha256', secret)
    .update(`${method} ${decoded} ${q} ${body}`)
    .digest('hex');
}

function verifySig(provided: string | undefined, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

// ────────────────────────────────────────────────────────────────────────────
// Path safety — realpath check defeats symlink escapes (DA-required)
// ────────────────────────────────────────────────────────────────────────────

async function safePath(input: string): Promise<string | null> {
  const rel = input.replace(/^\/+/, '');
  const abs = resolve(ICLOUD_ROOT, rel);
  // For new paths (writes that don't yet exist), check the parent's realpath.
  let checkPath = abs;
  if (!existsSync(abs)) checkPath = dirname(abs);
  let real: string;
  try {
    real = await realpath(checkPath);
  } catch {
    return null;        // unreadable / nonexistent ancestor
  }
  // ICLOUD_ROOT_REAL captures the realpath of root at boot (most stable).
  if (!real.startsWith(ICLOUD_ROOT_REAL + sep) && real !== ICLOUD_ROOT_REAL) {
    return null;
  }
  return abs;
}

// ────────────────────────────────────────────────────────────────────────────
// iCloud state — used by /health
// ────────────────────────────────────────────────────────────────────────────

async function getICloudState() {
  let signedIn = false;
  let appleId: string | null = null;
  try {
    const { stdout } = await execFile('defaults', ['read', 'MobileMeAccounts']);
    const m = stdout.match(/AccountID\s*=\s*"([^"]+)"/);
    if (m) { signedIn = true; appleId = m[1]; }
  } catch { /* signed out */ }

  const driveDirExists = existsSync(ICLOUD_ROOT);

  let birdRunning = false;
  try {
    // pgrep -x bird matches process named EXACTLY 'bird' (not 'firebird', not 'bird-server')
    await execFile('pgrep', ['-x', 'bird']);
    birdRunning = true;
  } catch { /* not running */ }

  let optimise: boolean | null = null;
  try {
    const { stdout } = await execFile('defaults', ['read', 'com.apple.bird', 'OptimizeStorage']);
    optimise = stdout.trim() === '1';
  } catch { /* unset */ }

  return { signed_in: signedIn, apple_id: appleId, drive_dir_exists: driveDirExists, bird_running: birdRunning, optimise_storage: optimise };
}

// ────────────────────────────────────────────────────────────────────────────
// Hono app
// ────────────────────────────────────────────────────────────────────────────

const app = new Hono();

// HMAC middleware — buffers body once, stores raw bytes on context, handlers
// re-read via c.get('rawBody'). Skip /health (which has its own auth gate).
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next();

  const method = c.req.method;
  const url = c.req.url;

  // Read body bytes ONCE, regardless of content type (handles binary uploads correctly).
  let bodyBytes: Buffer;
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    bodyBytes = Buffer.from(await c.req.arrayBuffer());
    if (bodyBytes.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: 'body_too_large', limit: MAX_UPLOAD_BYTES }, 413);
    }
  } else {
    bodyBytes = Buffer.alloc(0);
  }

  // Sign over the body's exact bytes (utf8 string for HMAC purposes — both
  // sides treat body bytes as utf8 since iCloud Drive write_file uses base64
  // wrapped in JSON, never raw binary in the HTTP body).
  const bodyStr = bodyBytes.toString('utf8');

  const secret = readSecret();
  const expected = expectedSig(secret, method, url, bodyStr);
  const provided = c.req.header('X-Nexley-Signature');
  if (!verifySig(provided, expected)) {
    return c.json({ ok: false, error: 'bad_signature' }, 401);
  }

  // Make body available to handlers
  (c as any).set('rawBody', bodyBytes);
  (c as any).set('rawBodyText', bodyStr);
  await next();
});

function jsonBody<T = any>(c: any): T {
  const text = c.get('rawBodyText') as string;
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { return {} as T; }
}

// ────────────────────────────────────────────────────────────────────────────
// /health — two-tier: unauthenticated returns minimal state, HMAC-signed
// returns full detail including Apple ID. DA-required: don't leak PII to
// every device on the tailnet.
// ────────────────────────────────────────────────────────────────────────────

app.get('/health', async (c) => {
  const minimal = await getICloudState();

  // Check if request is HMAC-signed (optional auth)
  const provided = c.req.header('X-Nexley-Signature');
  let signedRequest = false;
  if (provided) {
    const secret = readSecret();
    const expected = expectedSig(secret, 'GET', c.req.url, '');
    signedRequest = verifySig(provided, expected);
  }

  const status = (minimal.signed_in && minimal.drive_dir_exists && minimal.bird_running)
    ? 'connected'
    : 'icloud_not_ready';

  const warnings: string[] = [];
  if (!minimal.signed_in) warnings.push('Apple ID is not signed in on this Mac');
  if (minimal.signed_in && !minimal.drive_dir_exists) warnings.push('iCloud Drive folder missing — is iCloud Drive enabled?');
  if (minimal.signed_in && !minimal.bird_running) warnings.push('bird daemon (FileProvider) not running');
  if (minimal.optimise_storage === true) warnings.push('Optimise Mac Storage is ON — file reads will block. Turn OFF: defaults write com.apple.bird OptimizeStorage -bool false');

  return c.json({
    status,
    bridge: { up: true, version: '0.2.0', port: PORT },
    icloud: signedRequest
      ? minimal                          // signed: full detail incl Apple ID
      : { signed_in: minimal.signed_in, drive_dir_exists: minimal.drive_dir_exists, bird_running: minimal.bird_running, optimise_storage: minimal.optimise_storage },
    warnings,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Drive: list / read / write / delete / search
// ────────────────────────────────────────────────────────────────────────────

app.get('/files', async (c) => {
  const path = c.req.query('path') ?? '';
  const abs = await safePath(path);
  if (!abs) return c.json({ ok: false, error: 'path_traversal_or_missing' }, 400);
  if (!existsSync(abs)) return c.json({ ok: false, error: 'not_found', path }, 404);
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    const items = await Promise.all(entries.map(async (e) => {
      const full = join(abs, e.name);
      let st;
      try { st = await stat(full); } catch { return null; }
      return {
        name: e.name,
        is_dir: e.isDirectory(),
        size: e.isDirectory() ? null : st.size,
        modified: st.mtime.toISOString(),
        created: st.birthtime.toISOString(),
        suspect_placeholder: !e.isDirectory() && st.size === 0,
      };
    }));
    return c.json({ ok: true, path, items: items.filter(Boolean) });
  } catch (e: any) {
    return c.json({ ok: false, error: 'read_failed', detail: String(e.message ?? e) }, 500);
  }
});

app.get('/file', async (c) => {
  const path = c.req.query('path') ?? '';
  const abs = await safePath(path);
  if (!abs) return c.json({ ok: false, error: 'path_traversal_or_missing' }, 400);
  if (!existsSync(abs)) return c.json({ ok: false, error: 'not_found', path }, 404);
  const st = statSync(abs);
  if (st.isDirectory()) return c.json({ ok: false, error: 'is_directory' }, 400);
  if (st.size > MAX_UPLOAD_BYTES) return c.json({ ok: false, error: 'file_too_large', limit: MAX_UPLOAD_BYTES }, 413);
  const r = createReadStream(abs);
  return stream(c, async (out) => {
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Length', String(st.size));
    c.header('X-Nexley-Filename', basename(abs));
    for await (const chunk of r) await out.write(chunk as Uint8Array);
  });
});

// PUT /file: body shape is JSON { content_base64: string }. The HMAC
// covers the exact JSON bytes the client sent. Server decodes base64
// to get the file bytes.
app.put('/file', async (c) => {
  const path = c.req.query('path') ?? '';
  const abs = await safePath(path);
  if (!abs) return c.json({ ok: false, error: 'path_traversal_or_missing' }, 400);
  const { content_base64 } = jsonBody<{ content_base64?: string }>(c);
  if (!content_base64) return c.json({ ok: false, error: 'content_base64_required' }, 400);
  let buf: Buffer;
  try {
    buf = Buffer.from(content_base64, 'base64');
  } catch {
    return c.json({ ok: false, error: 'bad_base64' }, 400);
  }
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ ok: false, error: 'decoded_body_too_large', limit: MAX_UPLOAD_BYTES }, 413);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return c.json({ ok: true, path, size: buf.byteLength });
});

app.delete('/file', async (c) => {
  const path = c.req.query('path') ?? '';
  const abs = await safePath(path);
  if (!abs) return c.json({ ok: false, error: 'path_traversal_or_missing' }, 400);
  if (!existsSync(abs)) return c.json({ ok: false, error: 'not_found' }, 404);
  await unlink(abs);
  return c.json({ ok: true, path });
});

app.post('/search', async (c) => {
  const { query, max = 50 } = jsonBody<{ query: string; max?: number }>(c);
  if (!query) return c.json({ ok: false, error: 'query_required' }, 400);
  const cap = Math.min(Math.max(1, Number(max)), 200);

  let results: { path: string; method: 'spotlight' | 'find' }[] = [];
  // Try Spotlight (mdfind takes raw query — execFile w/ argv prevents shell injection)
  try {
    const { stdout } = await execFile('mdfind', ['-onlyin', ICLOUD_ROOT, query], {
      maxBuffer: 5_000_000,
      timeout: 8_000,
    });
    const paths = stdout.split('\n').filter(Boolean).slice(0, cap);
    if (paths.length > 0) {
      results = paths.map((p) => ({
        path: p.startsWith(ICLOUD_ROOT_REAL) ? p.slice(ICLOUD_ROOT_REAL.length) : p,
        method: 'spotlight' as const,
      }));
    }
  } catch { /* fallback */ }

  if (results.length === 0) {
    try {
      const { stdout } = await execFile('find', [
        ICLOUD_ROOT, '-iname', `*${query}*`,
      ], { maxBuffer: 5_000_000, timeout: 15_000 });
      results = stdout.split('\n').filter(Boolean).slice(0, cap).map((p) => ({
        path: p.startsWith(ICLOUD_ROOT_REAL) ? p.slice(ICLOUD_ROOT_REAL.length) : p,
        method: 'find' as const,
      }));
    } catch { /* both failed */ }
  }

  return c.json({
    ok: true,
    query,
    results,
    note: results.some((r) => r.method === 'find')
      ? 'Spotlight returned no results — fell back to filename match. Content-search is best-effort.'
      : undefined,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AppleScript helpers — write the script to a tempfile in 0700 dir and run
// `osascript /tmp/.../script.scpt`. Never interpolate user-controlled strings
// into the script source. We pass user data as `osascript -e 'tell ... to ...
// set arg to (item N of args)' file args` — argv-based.
// ────────────────────────────────────────────────────────────────────────────

async function runOsascript(scriptSource: string, args: string[] = [], timeoutMs = 30_000): Promise<string> {
  // mkdtemp with 0700 prevents other-user snooping on the script source
  const dir = mkdtempSync(join(tmpdir(), 'nexley-as-'));
  const scriptPath = join(dir, 'script.scpt');
  await writeFile(scriptPath, scriptSource, { mode: 0o600 });
  try {
    const { stdout } = await execFile('osascript', [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 10_000_000,
    });
    return stdout.trim();
  } finally {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Photos
// ────────────────────────────────────────────────────────────────────────────

app.post('/photos/find', async (c) => {
  const { since, until, max = 25 } = jsonBody<{ since?: string; until?: string; max?: number }>(c);
  // AppleScript reads since/until/max from argv via `on run argv`
  const script = `
on run argv
  set sinceStr to item 1 of argv
  set untilStr to item 2 of argv
  set maxN to (item 3 of argv) as integer
  set sinceDate to missing value
  set untilDate to missing value
  if sinceStr is not "" then set sinceDate to (date sinceStr)
  if untilStr is not "" then set untilDate to (date untilStr)
  tell application "Photos"
    set found to {}
    set allItems to media items
    if (count of allItems) > (maxN * 4) then set allItems to items 1 thru (maxN * 4) of allItems
    repeat with itm in allItems
      set itmDate to date of itm
      if (sinceDate is missing value or itmDate >= sinceDate) and (untilDate is missing value or itmDate <= untilDate) then
        set end of found to {id of itm, name of itm, itmDate as string}
        if (count of found) >= maxN then exit repeat
      end if
    end repeat
    return found as string
  end tell
end run
  `.trim();
  try {
    const raw = await runOsascript(script, [since ?? '', until ?? '', String(max)], 60_000);
    return c.json({ ok: true, raw, hint: 'parse the raw string client-side: triples of {id, name, date}' });
  } catch (e: any) {
    return c.json({ ok: false, error: 'photos_query_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

app.post('/photos/download', async (c) => {
  const { id } = jsonBody<{ id: string }>(c);
  if (!id) return c.json({ ok: false, error: 'id_required' }, 400);
  const tmpd = mkdtempSync(join(tmpdir(), 'nexley-photo-'));
  const script = `
on run argv
  set itemId to item 1 of argv
  set destPath to item 2 of argv
  tell application "Photos"
    set tgt to media item id itemId
    export {tgt} to POSIX file destPath with using originals
  end tell
end run
  `.trim();
  try {
    await runOsascript(script, [id, tmpd], 90_000);
    const files = await readdir(tmpd);
    if (!files.length) return c.json({ ok: false, error: 'export_produced_no_files' }, 500);
    // Live Photos export pairs (HEIC + MOV) — return the largest file (the still or video)
    const sorted = files
      .map((f) => ({ name: f, size: statSync(join(tmpd, f)).size }))
      .sort((a, b) => b.size - a.size);
    const filePath = join(tmpd, sorted[0].name);
    const st = statSync(filePath);
    const r = createReadStream(filePath);
    return stream(c, async (out) => {
      c.header('Content-Type', 'application/octet-stream');
      c.header('Content-Length', String(st.size));
      c.header('X-Nexley-Filename', sorted[0].name);
      for await (const chunk of r) await out.write(chunk as Uint8Array);
      try { await rm(tmpd, { recursive: true, force: true }); } catch {}
    });
  } catch (e: any) {
    try { await rm(tmpd, { recursive: true, force: true }); } catch {}
    return c.json({ ok: false, error: 'photos_download_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<\/?(p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

app.post('/notes/list', async (c) => {
  const { max = 200 } = jsonBody<{ max?: number }>(c);
  const cap = Math.min(Math.max(1, Number(max)), 1000);
  const script = `
on run argv
  set maxN to (item 1 of argv) as integer
  tell application "Notes"
    set out to {}
    set i to 0
    repeat with n in notes
      set i to i + 1
      if i > maxN then exit repeat
      set end of out to {id of n, name of n}
    end repeat
    return out as string
  end tell
end run
  `.trim();
  try {
    const raw = await runOsascript(script, [String(cap)], 60_000);
    return c.json({ ok: true, raw });
  } catch (e: any) {
    return c.json({ ok: false, error: 'notes_list_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

app.post('/notes/get', async (c) => {
  const { id } = jsonBody<{ id: string }>(c);
  if (!id) return c.json({ ok: false, error: 'id_required' }, 400);
  const script = `
on run argv
  set noteId to item 1 of argv
  tell application "Notes"
    return body of note id noteId
  end tell
end run
  `.trim();
  try {
    const html = await runOsascript(script, [id], 30_000);
    return c.json({ ok: true, id, html, text: stripHtml(html) });
  } catch (e: any) {
    return c.json({ ok: false, error: 'notes_get_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

app.post('/notes/create', async (c) => {
  const { title, body } = jsonBody<{ title: string; body: string }>(c);
  if (!title || !body) return c.json({ ok: false, error: 'title_and_body_required' }, 400);
  const sizeKB = Math.ceil(Buffer.byteLength(body, 'utf8') / 1024);
  const script = `
on run argv
  set t to item 1 of argv
  set b to item 2 of argv
  tell application "Notes"
    set newNote to make new note with properties {name:t, body:b}
    return id of newNote
  end tell
end run
  `.trim();
  try {
    const id = await runOsascript(script, [title, body], 30_000);
    return c.json({ ok: true, id, warning: sizeKB > 100 ? 'Body >100KB — Sequoia silently truncates above this' : undefined });
  } catch (e: any) {
    return c.json({ ok: false, error: 'notes_create_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Shortcuts — execFile with argv (no shell, no injection)
// ────────────────────────────────────────────────────────────────────────────

app.post('/shortcuts/list', async (c) => {
  try {
    const { stdout } = await execFile('shortcuts', ['list'], { timeout: 10_000, maxBuffer: 1_000_000 });
    return c.json({ ok: true, shortcuts: stdout.split('\n').filter(Boolean) });
  } catch (e: any) {
    return c.json({ ok: false, error: 'shortcuts_list_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

app.post('/shortcuts/run', async (c) => {
  const { name, input } = jsonBody<{ name: string; input?: string }>(c);
  if (!name) return c.json({ ok: false, error: 'name_required' }, 400);
  const args = ['run', name];
  if (input) args.push('--input', input);
  try {
    const { stdout } = await execFile('shortcuts', args, { timeout: 60_000, maxBuffer: 10_000_000 });
    return c.json({ ok: true, output: stdout.trim() });
  } catch (e: any) {
    return c.json({ ok: false, error: 'shortcut_run_failed', detail: String(e.message ?? e).slice(0, 300) }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /admin/rotate — atomic file write. No process restart needed: the secret
// is read from disk on every request.
// ────────────────────────────────────────────────────────────────────────────

app.post('/admin/rotate', async (c) => {
  const { new_secret } = jsonBody<{ new_secret: string }>(c);
  if (!new_secret || typeof new_secret !== 'string') {
    return c.json({ ok: false, error: 'new_secret_required' }, 400);
  }
  if (!/^[A-Za-z0-9+/=_-]{32,}$/.test(new_secret)) {
    return c.json({ ok: false, error: 'bad_secret_format', detail: 'must be ≥32 chars hex/base64/url-safe' }, 400);
  }
  // Atomic write: temp file + rename
  const tmp = `${SECRET_FILE}.tmp.${process.pid}.${Date.now()}`;
  await mkdir(dirname(SECRET_FILE), { recursive: true });
  await writeFile(tmp, new_secret, { mode: 0o600 });
  const { rename } = await import('node:fs/promises');
  await rename(tmp, SECRET_FILE);
  return c.json({
    ok: true,
    message: 'Secret rotated atomically. New requests must use the new secret immediately.',
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────────

console.error(`[bridge] starting on ${HOST}:${PORT}, iCloud root: ${ICLOUD_ROOT}`);
console.error(`[bridge] secret file: ${SECRET_FILE}`);
console.error(`[bridge] max upload: ${MAX_UPLOAD_BYTES} bytes`);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
  // Increase max body for binary uploads (Bun default is 100MB; we cap explicitly above)
  maxRequestBodySize: MAX_UPLOAD_BYTES + 1_000_000,   // small headroom for headers
};
