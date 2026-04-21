'use client'

import { useState } from 'react'
import { updateAgentConfig } from '@/app/(dashboard)/settings/actions'
import { toast } from 'sonner'

interface EmployeeNameEditorProps {
  initialName: string
}

export default function EmployeeNameEditor({ initialName }: EmployeeNameEditorProps) {
  const [name, setName] = useState(initialName || 'Nexley')
  const [saving, setSaving] = useState(false)

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && trimmed.length <= 30 && trimmed !== initialName.trim()

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('agent_name', trimmed)
      await updateAgentConfig(fd)
      toast.success(`Saved — your AI employee is now called ${trimmed}`)
    } catch (e) {
      toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="agent-name-input">
          AI Employee Name
        </label>
        <input
          id="agent-name-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value.slice(0, 30))}
          maxLength={30}
          placeholder="Nexley"
          className="w-full px-3 py-2 rounded-lg border text-sm bg-card-bg text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {trimmed.length === 0
            ? 'Required'
            : `${trimmed.length}/30`}
          {' · '}
          This is the name your customers see on WhatsApp (e.g. &ldquo;Aiden&rdquo;, &ldquo;Sarah&rdquo;, &ldquo;Nexley&rdquo;).
        </p>
      </div>

      <div className="rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
        <p className="text-sm text-foreground italic">
          Hey there! I&apos;m <strong>{trimmed || 'Nexley'}</strong> — happy to help.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
        {trimmed !== initialName.trim() && (
          <button
            onClick={() => setName(initialName)}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Note:</strong> Changing the name updates the dashboard + any new conversations.
        On-VPS agents will pick up the new name on their next natural session reload (typically
        within a few hours). If you need it to take effect immediately, ping support.
      </p>
    </div>
  )
}
