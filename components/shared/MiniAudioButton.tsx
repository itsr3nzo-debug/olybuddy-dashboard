'use client'

import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'

// Singleton: only one mini player active at a time
let globalAudio: HTMLAudioElement | null = null
let globalSetPlaying: ((v: boolean) => void) | null = null

interface MiniAudioButtonProps {
  recordingUrl: string | null | undefined
}

export default function MiniAudioButton({ recordingUrl }: MiniAudioButtonProps) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        if (globalAudio === audioRef.current) {
          globalAudio = null
          globalSetPlaying = null
        }
      }
    }
  }, [])

  if (!recordingUrl) return null

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()

    if (playing && audioRef.current) {
      audioRef.current.pause()
      setPlaying(false)
      return
    }

    // Stop any other playing instance
    if (globalAudio && globalAudio !== audioRef.current) {
      globalAudio.pause()
      globalSetPlaying?.(false)
    }

    if (!audioRef.current) {
      setLoading(true)
      const audio = new Audio(recordingUrl!)
      audioRef.current = audio
      audio.oncanplay = () => setLoading(false)
      audio.onended = () => setPlaying(false)
      audio.onerror = () => { setLoading(false); setPlaying(false) }
    }

    audioRef.current.play()
    setPlaying(true)
    globalAudio = audioRef.current
    globalSetPlaying = setPlaying
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 transition-colors"
      aria-label={playing ? 'Pause recording' : 'Play recording'}
    >
      {loading ? (
        <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-brand-primary/30 border-t-brand-primary" />
      ) : playing ? (
        <Pause size={12} />
      ) : (
        <Play size={12} className="ml-0.5" />
      )}
    </button>
  )
}
