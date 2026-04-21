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

/**
 * Upload a single file to Supabase Storage. Returns a public URL the agent
 * can fetch from its VPS (Storage CDN is world-readable for the public bucket).
 *
 * Path: chat-attachments/<client_id>/<session_id>/<timestamp>-<safe-name>
 * so every file is scoped to a client + session for auditability.
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
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) return { ok: false, error: error.message };
  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    ok: true,
    attachment: {
      url: publicUrl,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      kind: kindFromMime(file.type || ''),
    },
  };
}
