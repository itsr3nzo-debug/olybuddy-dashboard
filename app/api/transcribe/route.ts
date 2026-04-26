import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// POST /api/transcribe
//   multipart/form-data with field `audio` (Blob) — webm/mp4/wav/mp3/ogg.
//   Uses ElevenLabs Scribe STT (model_id=scribe_v1) which handles every
//   common browser MediaRecorder mime-type without server-side transcode.
//   Returns { ok: true, text: "..." } on success or { ok: false, error }.
//
// Auth: any signed-in user can hit this (we read the Supabase auth cookie).
// We don't pin to a specific client_id — voice input is a UI capability,
// not a per-client billable action.

export const runtime = 'nodejs'
// 25 MB cap — ElevenLabs Scribe accepts up to ~1GB but we don't need that;
// at typical opus 32kbps a 25MB file is ~100 minutes which is more than
// anyone will hold-to-talk into a chat composer.
export const maxDuration = 60

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function isSignedIn(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return false
  try {
    const cookieStore = await cookies()
    const all = cookieStore.getAll()
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { cookie: all.map(c => `${c.name}=${c.value}`).join('; ') } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await sb.auth.getUser()
    return !!data.user
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json({ ok: false, error: 'transcription_not_configured' }, { status: 503 })
  }
  if (!(await isSignedIn())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let audio: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f && typeof f !== 'string') audio = f as File
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form' }, { status: 400 })
  }
  if (!audio) {
    return NextResponse.json({ ok: false, error: 'no_audio' }, { status: 400 })
  }
  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'audio_too_large' }, { status: 413 })
  }
  if (audio.size < 200) {
    // Empty or near-empty recording — likely the user clicked the button
    // and immediately clicked stop. Surface a friendly error rather than
    // sending a billable round-trip to ElevenLabs.
    return NextResponse.json({ ok: false, error: 'recording_too_short' }, { status: 400 })
  }

  // ElevenLabs Scribe v1 — POST multipart with `file`, `model_id`.
  const upstream = new FormData()
  upstream.append('file', audio, audio.name || 'audio.webm')
  upstream.append('model_id', 'scribe_v1')
  // Auto-detect language — Scribe handles 99 languages including en-GB.
  upstream.append('tag_audio_events', 'false')
  upstream.append('diarize', 'false')

  let res: Response
  try {
    res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: upstream,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'upstream_unreachable', detail: String(e) }, { status: 502 })
  }

  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch {}
    return NextResponse.json(
      { ok: false, error: 'upstream_error', status: res.status, detail: detail.slice(0, 500) },
      { status: 502 },
    )
  }

  let data: unknown
  try { data = await res.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid_upstream_response' }, { status: 502 })
  }

  // Scribe returns { text, language_code, language_probability, words: [...] }
  const text = (data && typeof data === 'object' && 'text' in data) ? String((data as { text: unknown }).text || '').trim() : ''
  if (!text) {
    return NextResponse.json({ ok: false, error: 'no_speech_detected' }, { status: 422 })
  }

  return NextResponse.json({ ok: true, text })
}
