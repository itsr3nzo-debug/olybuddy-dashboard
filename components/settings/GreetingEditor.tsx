'use client'

import { useState } from 'react'
import { updateAgentConfig } from '@/app/(dashboard)/settings/actions'
import { toast } from 'sonner'

interface GreetingEditorProps {
  initialGreeting: string
}

export default function GreetingEditor({ initialGreeting }: GreetingEditorProps) {
  const [greeting, setGreeting] = useState(initialGreeting)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('greeting_message', greeting)
      await updateAgentConfig(fd)
      toast.success('Greeting saved')
    } catch (e) {
      toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          Greeting Message
        </label>
        <textarea
          value={greeting}
          onChange={e => setGreeting(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none resize-none"
          placeholder="Hey, thanks for calling! How can I help you today?"
          maxLength={300}
        />
        <p className="text-xs text-muted-foreground mt-1">{greeting.length}/300 characters</p>
      </div>

      {greeting && (
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
          <p className="text-sm text-foreground italic">&ldquo;{greeting}&rdquo;</p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving...' : 'Save Greeting'}
      </button>
    </div>
  )
}
