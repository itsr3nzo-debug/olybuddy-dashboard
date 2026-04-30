# Build progress discipline

The `/build/mobile?key=...` page is the user's window into what's being built.
It only stays useful if the data behind it stays fresh. This is the contract.

## Tables (Supabase)

- **`build_progress`** — single row per `(project_slug, phase)`, holds current
  state: current_task, todo snapshot, chunks-done-today counter, last
  preview/screenshot/commit, blocked flag.
- **`build_chunks`** — append-only log of work units. Each row = one chunk
  (~10-30 min of work). Status: `in_progress` → `done` (or `blocked`/`reverted`).
- **`build_tokens`** — URL access tokens for the `/build/{project}` page.
  Rotated weekly by `/api/cron/rotate-build-token`.

## When to write a chunk

A "chunk" is roughly:
- One TodoWrite item being worked on, OR
- Any 10–30 minute block of focused work, OR
- Anything that produces a commit, schema migration, or noteworthy artifact

Don't write per-file-save (too noisy). Don't go a whole hour without writing
(too silent). Aim for ~3-6 chunks per hour during active build.

## Calling pattern

From inside agent code (TypeScript):

```ts
import { markChunkStart, markChunkDone, setBlocked, syncTodos } from '@/lib/build/progress'

// 1. Sync the todo list whenever you update it
await syncTodos([
  { content: 'Apply migration', status: 'completed' },
  { content: 'Build helpers', status: 'in_progress' },
  { content: 'Build status page', status: 'pending' },
])

// 2. At the start of a chunk
const chunkId = await markChunkStart({
  title: 'Build /build/mobile status page',
  files_touched: ['app/build/mobile/page.tsx'],
})

// 3. Do the work…

// 4. At the end
await markChunkDone(chunkId, {
  summary: 'Mobile-first server-rendered page with Supabase realtime sub.',
  typecheck_status: 'clean',
  commit_sha: process.env.VERCEL_GIT_COMMIT_SHA,
})
```

From outside agent code (HTTP — for cron jobs / deploy hooks):

```bash
# Sync todos
curl -X POST https://nexley.vercel.app/api/build/sync-todos \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"todos":[{"content":"...","status":"in_progress"}], "current_task":"..."}'
```

## Blocked state

If you hit a blocker (waiting for human input, env var missing, dep broken):

```ts
await setBlocked('Waiting for VERCEL_WEBHOOK_SECRET to be set on prod')
```

The page header turns amber + shows the reason. Clear when resolved:

```ts
await clearBlocked()
```

## "Today" boundary

`chunks_done_today` resets at **05:00 Europe/London**, not UTC midnight (DA fix
D7). This means a chunk landing at 23:50 still counts as "today" — fits human
mental model better than UTC.

## Anti-patterns

- ❌ Calling `markChunkStart` with no matching `markChunkDone` (orphan in_progress chunk forever)
- ❌ Writing chunks for trivial things ("renamed variable") — noise
- ❌ Letting `current_task` drift from reality (page lies)
- ❌ Forgetting to update `todo_snapshot` after TodoWrite changes (page subtasks lie)
- ❌ Using a per-line-of-code chunk granularity (too many notifications)

## URL token

The user's bookmark URL contains a token validated against `build_tokens`.
Tokens auto-rotate weekly via the cron. After rotation, the user gets an
email with the new URL; old token has a 24h grace window so they don't miss
a beat.

If the user ever needs to revoke immediately (lost phone, screenshot leaked):

```sql
update public.build_tokens set revoked_at = now() where project_slug = 'mobile';
-- then trigger immediate rotation:
-- curl -H "Authorization: Bearer $CRON_SECRET" https://nexley.vercel.app/api/cron/rotate-build-token
```

## Smoke testing

After deploying, validate the chain works:

```bash
# 1. Write a fake chunk
curl -X POST https://nexley.vercel.app/api/build/sync-todos \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"current_task":"Smoke test","todos":[{"content":"Smoke","status":"in_progress"}]}'

# 2. Open the page in your phone — you should see "Smoke test" within 2s
# 3. Wait until 18:00 London → expect digest email
```
