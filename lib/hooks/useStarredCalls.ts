'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'olybuddy-starred-calls'
const MAX_STARRED = 50

export function useStarredCalls() {
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setStarredIds(new Set(JSON.parse(stored)))
    } catch { /* ignore parse errors */ }
  }, [])

  const toggleStar = useCallback((id: string) => {
    setStarredIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= MAX_STARRED) {
          const first = next.values().next().value
          if (first) next.delete(first)
        }
        next.add(id)
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const isStarred = useCallback((id: string) => starredIds.has(id), [starredIds])

  return { starredIds, toggleStar, isStarred }
}
