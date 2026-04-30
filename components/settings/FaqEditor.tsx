'use client'

import { useState } from 'react'
import { updateAgentConfig } from '@/app/(dashboard)/settings/actions'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

interface FaqItem {
  question: string
  answer: string
}

interface FaqEditorProps {
  initialFaqs: FaqItem[]
}

export default function FaqEditor({ initialFaqs }: FaqEditorProps) {
  const [faqs, setFaqs] = useState<FaqItem[]>(initialFaqs.length > 0 ? initialFaqs : [])
  const [saving, setSaving] = useState(false)

  function addFaq() {
    setFaqs(prev => [...prev, { question: '', answer: '' }])
  }

  function removeFaq(index: number) {
    setFaqs(prev => prev.filter((_, i) => i !== index))
  }

  function updateFaq(index: number, field: 'question' | 'answer', value: string) {
    setFaqs(prev => prev.map((faq, i) => i === index ? { ...faq, [field]: value } : faq))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('faqs', JSON.stringify(faqs.filter(f => f.question.trim() && f.answer.trim())))
      await updateAgentConfig(fd)
      toast.success('FAQs saved')
    } catch (e) {
      toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {faqs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add FAQs to help your AI Employee answer common questions about your business.
        </p>
      ) : (
        faqs.map((faq, i) => (
          <div key={i} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Question</label>
                <input
                  value={faq.question}
                  onChange={e => updateFaq(i, 'question', e.target.value)}
                  placeholder="e.g. What areas do you cover?"
                  className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
                  maxLength={200}
                />
              </div>
              <button
                onClick={() => removeFaq(i)}
                className="mt-5 p-1.5 rounded-lg text-muted-foreground hover:text-brand-danger hover:bg-brand-danger/10 transition-colors"
                aria-label="Remove FAQ"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Answer</label>
              <textarea
                value={faq.answer}
                onChange={e => updateFaq(i, 'answer', e.target.value)}
                placeholder="e.g. We cover all of Greater Manchester and surrounding areas."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none resize-none"
                maxLength={500}
              />
            </div>
          </div>
        ))
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={addFaq}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors"
        >
          <Plus size={14} /> Add FAQ
        </button>
        {faqs.length > 0 && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save FAQs'}
          </button>
        )}
      </div>
    </div>
  )
}
