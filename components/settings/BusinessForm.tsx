'use client'

import { useState } from 'react'
import { updateBusinessDetails } from '@/app/(dashboard)/settings/actions'
import { toast } from 'sonner'

interface BusinessFormProps {
  initialName: string
  initialEmail: string
  initialPhone: string
}

export default function BusinessForm({ initialName, initialEmail, initialPhone }: BusinessFormProps) {
  const [saving, setSaving] = useState(false)

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    try {
      await updateBusinessDetails(formData)
      toast.success('Business details saved')
    } catch (e) {
      toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Business Name</label>
        <input
          name="name"
          defaultValue={initialName}
          className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Contact Email</label>
        <input
          name="email"
          type="email"
          defaultValue={initialEmail}
          className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Contact Phone</label>
        <input
          name="phone"
          defaultValue={initialPhone}
          className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  )
}
