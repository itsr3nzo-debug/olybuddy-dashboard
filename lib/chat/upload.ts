'use client';

import { createClient } from '@/lib/supabase/client';
import type { Attachment } from './types';

const BUCKET = 'chat-attachments';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

function kindFromMime(mime: string): Attachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

export interface UploadResult {
  ok: true;
  attachment: Attachment;
}
export interface UploadError {
  ok: false;
  error: string;
}

// 7 days. Signed URLs can be re-minted by the browser any time the user is
// signed in (RLS grants SELECT on objects in their own client_id folder),
// so 7 days is a balance between cache-friendly chat history and limiting
// the blast radius if a URL leaks via a screenshot or log.
const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * Upload a single file to the private `chat-attachments` Supabase Storage
 * bucket. Returns a short-lived signed URL the dashboard UI can render from.
 *
 * Path layout: chat-attachments/<client_id>/<session_id>/<timestamp>-<safe-name>
 * RLS (chat_attachments_owner_insert / _owner_read) enforces that the
 * `<client_id>` segment matches the user's JWT app_metadata.client_id —
 * a malicious user cannot upload into another tenant's folder, nor read
 * objects from one.
 *
 * Server-side code (e.g. /api/chat/stream when we eventually pass attachments
 * to Claude) should call createSignedUrl with the service-role client and
 * a tight TTL covering the request lifetime, NOT reuse the URL stored here.
 */
export async function uploadAttachment(
  file: File,
  clientId: string,
  sessionId: string | null,
): Promise<UploadResult | UploadError> {
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 50MB)` };
  }
  const supabase = createClient();
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const ts = Date.now();
  const session = sessionId || 'draft';
  const path = `${clientId}/${session}/${ts}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (signError || !signed?.signedUrl) {
    return { ok: false, error: signError?.message ?? 'Could not sign attachment URL' };
  }

  return {
    ok: true,
    attachment: {
      url: signed.signedUrl,
      path,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      kind: kindFromMime(file.type || ''),
    },
  };
}
