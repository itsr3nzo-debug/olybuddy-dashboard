'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'
import { formatDuration } from '@/lib/format'

interface AudioPlayerProps {
  url: string
  onTimeUpdate?: (seconds: number) => void
  className?: string
}

export default function AudioPlayer({ url, onTimeUpdate, className = '' }: AudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !url) return

    let ws: import('wavesurfer.js').default | null = null

    async function init() {
      try {
        const WaveSurfer = (await import('wavesurfer.js')).default
        if (!containerRef.current) return

        ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: 'var(--border)',
          progressColor: 'var(--brand-primary)',
          cursorColor: 'var(--brand-primary)',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 48,
          url,
        })

        wavesurferRef.current = ws

        ws.on('ready', () => {
          setDuration(ws!.getDuration())
          setIsLoading(false)
        })

        ws.on('timeupdate', (time: number) => {
          setCurrentTime(time)
          onTimeUpdate?.(time)
        })

        ws.on('play', () => setIsPlaying(true))
        ws.on('pause', () => setIsPlaying(false))
        ws.on('finish', () => setIsPlaying(false))
        ws.on('error', () => {
          setError(true)
          setIsLoading(false)
        })
      } catch {
        setError(true)
        setIsLoading(false)
      }
    }

    init()

    return () => {
      ws?.destroy()
      wavesurferRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onTimeUpdate is stable via caller's useCallback
  }, [url])

  if (error) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground ${className}`}>
        <Volume2 size={16} />
        <span>Recording unavailable</span>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          Loading audio...
        </div>
      )}
      <div ref={containerRef} className={isLoading ? 'hidden' : ''} />
      {!isLoading && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => wavesurferRef.current?.playPause()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-primary text-white transition-colors hover:bg-brand-primary/90"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(Math.round(currentTime))} / {formatDuration(Math.round(duration))}
          </span>
        </div>
      )}
    </div>
  )
}
