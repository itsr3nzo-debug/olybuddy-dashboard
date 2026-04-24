/**
 * POST /api/vault/upload/complete
 *   body: { file_id }
 *   → { file: { id, status, ... } }
 *
 * Called by the browser once the signed-URL PUT to Storage has finished.
 * Verifies the object actually exists, runs inline text extraction for
 * supported types (pdf/docx/txt/md/csv), and flips status to 'ready' or
 * 'failed'. Images don't get extracted text — the agent can still read the
 * image via signed URL when asked.
 *
 * V1 does extraction inline (10s Vercel budget is enough for most <5MB
 * documents). If we hit real-world timeouts we'll move this into a Supabase
 * edge function or a background queue — the status='processing' state
 * transition already supports async flow.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { vaultService, VAULT_BUCKET } from '@/lib/vault/server'

// Lazy imports keep cold-start fast — pdf-parse / mammoth pull in hefty deps
// and most upload.complete calls are for tiny text files.
type MammothModule = { extractRawText: (args: { buffer: Buffer }) => Promise<{ value: string }> }

async function extractText(buf: Buffer, mime: string): Promise<{ text: string; pages?: number }> {
  if (mime === 'application/pdf') {
    // pdf-parse 2.x ships a class-based API (PDFParse) backed by pdf.js.
    // Construct, call getText(), dispose. `destroy()` cleans up the underlying
    // pdf.js worker so we don't leak between serverless invocations.
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buf) })
    try {
      const out = await parser.getText()
      return { text: out.text ?? '', pages: out.pages?.length }
    } finally {
      await parser.destroy().catch(() => {})
    }
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mime === 'application/msword') {
    const mammoth = (await import('mammoth')) as unknown as MammothModule
    const out = await mammoth.extractRawText({ buffer: buf })
    return { text: out.value ?? '' }
  }
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv') {
    return { text: buf.toString('utf-8') }
  }
  // Images + anything else — no text extraction. Citation still works via
  // filename; agent can open the signed URL if needed.
  return { text: '' }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const fileId: string | undefined = body?.file_id
  if (!fileId) return NextResponse.json({ error: 'missing file_id' }, { status: 400 })

  const svc = vaultService()
  const { data: row, error } = await svc
    .from('vault_files')
    .select('id, client_id, project_id, storage_path, filename, mime_type, size_bytes, status')
    .eq('id', fileId)
    .maybeSingle()
  if (error || !row) return NextResponse.json({ error: 'file not found' }, { status: 404 })
  // Don't let someone else's user complete a row they don't own. Resolve
  // the caller's client the same way upload does and compare.
  const callerClient = (user.app_metadata?.role === 'super_admin')
    ? row.client_id // admins can touch anything
    : (user.app_metadata?.client_id as string | undefined)
  if (callerClient !== row.client_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Flip to processing first — idempotent if called twice, and gives the UI
  // a clean signal that extraction is in flight.
  await svc.from('vault_files').update({ status: 'processing' }).eq('id', fileId)

  // Download the object we just uploaded so we can run extraction.
  const { data: blob, error: dlErr } = await svc.storage.from(VAULT_BUCKET).download(row.storage_path)
  if (dlErr || !blob) {
    await svc.from('vault_files').update({
      status: 'failed',
      error_message: `download after upload failed: ${dlErr?.message || 'unknown'}`,
    }).eq('id', fileId)
    return NextResponse.json({ error: 'upload not found in storage' }, { status: 409 })
  }

  const buf = Buffer.from(await blob.arrayBuffer())
  const sha = createHash('sha256').update(buf).digest('hex')

  let text = ''
  let pages: number | undefined
  try {
    const ext = await extractText(buf, row.mime_type ?? '')
    text = ext.text
    pages = ext.pages
  } catch (e) {
    await svc.from('vault_files').update({
      status: 'failed',
      error_message: `extract failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      sha256: sha,
      processed_at: new Date().toISOString(),
    }).eq('id', fileId)
    return NextResponse.json({
      file: { id: fileId, status: 'failed', error_message: 'text extraction failed' },
    })
  }

  const { data: updated } = await svc
    .from('vault_files')
    .update({
      status: 'ready',
      extracted_text: text.slice(0, 1_500_000), // 1.5 MB cap on text column — very generous
      page_count: pages ?? null,
      sha256: sha,
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', fileId)
    .select('id, status, page_count, sha256')
    .single()

  return NextResponse.json({ file: updated })
}
