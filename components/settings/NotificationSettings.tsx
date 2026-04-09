'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Mail, MessageSquare, Send } from 'lucide-react'

interface NotificationSettingsProps {
  emailEnabled?: boolean
  telegramEnabled?: boolean
}

export default function NotificationSettings({ emailEnabled = true, telegramEnabled = false }: NotificationSettingsProps) {
  const [email, setEmail] = useState(emailEnabled)
  const [telegram, setTelegram] = useState(telegramEnabled)

  function Toggle({ checked, onChange, label, icon, description, disabled = false }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; icon: React.ReactNode; description: string; disabled?: boolean
  }) {
    return (
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted text-muted-foreground">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={checked}
          aria-label={`${label} notifications`}
          disabled={disabled}
          onClick={() => {
            onChange(!checked)
            toast.success(`${label} notifications ${!checked ? 'enabled' : 'disabled'}`)
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${checked ? 'bg-brand-primary' : 'bg-muted'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      <Toggle
        checked={email}
        onChange={setEmail}
        label="Email"
        icon={<Mail size={14} />}
        description="Get notified when your AI misses a call or a new booking is made"
      />
      <Toggle
        checked={telegram}
        onChange={setTelegram}
        label="Telegram"
        icon={<Send size={14} />}
        description="Instant Telegram notifications for every call"
      />
      <Toggle
        checked={false}
        onChange={() => {}}
        label="SMS"
        icon={<MessageSquare size={14} />}
        description="SMS notifications — coming soon"
        disabled
      />
    </div>
  )
}
