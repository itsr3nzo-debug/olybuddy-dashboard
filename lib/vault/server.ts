/**
 * Vault server helpers — shared between the user-auth routes under
 * /api/vault/** and the agent-auth routes under /api/agent/vault/**.
 *
 * Key patterns:
 *  - Upload is a two-step dance: client calls POST /api/vault/upload to get
 *    a signed upload URL + file_id; uploads directly to Storage; then calls
 *    POST /api/vault/upload/complete to mark uploaded.
 *  - The agent never talks to Storage directly. It calls
 *    /api/agent/vault/file which returns `{ extracted_text, signed_url, ... }`
 *    — signed URL is minted with service-role and valid for 1h.
 *  - Storage paths are always `{client_id}/{project_id}/{file_uuid}-{slug}.{ext}`.
 *    Storage RLS + our helpers both enforce that shape so cross-tenant reads
 *    require two independent policy bypasses, not one.
 */

import { createClient } from '@supabase/supabase-js'

export const VAULT_BUCKET = 'vault'
// Max file size — matches the bucket config (100 MB). Dashboard UI pre-
// validates before even requesting a signed URL so we don't mint URLs we
// know will 413 on upload.
export const MAX_FILE_BYTES = 100 * 1024 * 1024
export const UPLOAD_URL_EXPIRES_SEC = 60 * 15 // 15 min to finish the PUT
export const DOWNLOAD_URL_EXPIRES_SEC = 60 * 60 // 1h for downloads / citations

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (older format)
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
])

export function isAllowedMime(mime: string | undefined | null): boolean {
  if (!mime) return false
  return ALLOWED_MIMES.has(mime)
}

/** Service-role Supabase client — bypasses RLS. Only use server-side after
 * verifying the caller is authorised to touch the requested client_id. */
export function vaultService() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Slugify a filename so it's safe in a URL/path. Preserves the extension. */
export function slugifyFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file'
  return ext ? `${slug}.${ext.replace(/[^a-z0-9]/g, '')}` : slug
}

/** Build the canonical storage path for a file. Always prefixed by client_id
 * so the storage RLS policy (foldername()[1] = client_id) matches. */
export function storagePathFor(args: {
  clientId: string
  projectId: string
  fileId: string
  filename: string
}): string {
  return `${args.clientId}/${args.projectId}/${args.fileId}-${slugifyFilename(args.filename)}`
}

/** Convert the Supabase Storage create-signed-upload-url result into what we
 * return to the browser. Keeps the upload URL / token fields stable so the
 * client code doesn't have to care about shape changes inside Supabase SDK. */
export interface SignedUploadSpec {
  upload_url: string
  token: string
  path: string
  expires_in: number
}
