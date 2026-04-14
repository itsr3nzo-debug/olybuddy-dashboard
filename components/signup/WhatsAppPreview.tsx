'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Phone, Video, MoreVertical, Check, CheckCheck } from 'lucide-react'
import { getPreviewConversation } from '@/lib/personality-previews'

interface WhatsAppPreviewProps {
  industry: string
  personality: string
}

export default function WhatsAppPreview({ industry, personality }: WhatsAppPreviewProps) {
  const [conversation, setConversation] = useState(() =>
    getPreviewConversation(industry || 'plumber', personality || 'friendly')
  )
  const [isTyping, setIsTyping] = useState(false)
  const [showResponse, setShowResponse] = useState(true)
  const prevKey = useRef(`${industry}-${personality}`)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = `${industry}-${personality}`
    if (key === prevKey.current) return
    prevKey.current = key

    // Hide current response, show typing, then reveal new one
    setShowResponse(false)
    setIsTyping(true)

    const timer = setTimeout(() => {
      setConversation(getPreviewConversation(industry || 'plumber', personality || 'friendly'))
      setIsTyping(false)
      setShowResponse(true)
    }, 800)

    return () => clearTimeout(timer)
  }, [industry, personality])

  // Scroll to bottom when new message appears
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [showResponse, isTyping])

  const businessName = getBusinessName(industry)

  return (
    <div className="mx-auto w-full max-w-[320px]">
      {/* iPhone frame */}
      <div className="overflow-hidden rounded-[2.5rem] border-4 border-gray-700 bg-[#0b141a] shadow-2xl shadow-black/50">
        {/* Status bar (tiny) */}
        <div className="flex items-center justify-between bg-[#1f2c34] px-6 pb-0 pt-3">
          <span className="text-[10px] font-medium text-white/60">9:41</span>
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-white/60" />
            <div className="h-2 w-3 rounded-sm border border-white/60">
              <div className="ml-auto h-full w-2/3 rounded-sm bg-white/60" />
            </div>
          </div>
        </div>

        {/* WhatsApp top bar */}
        <div className="flex items-center gap-3 bg-[#1f2c34] px-3 pb-3 pt-2">
          {/* Back arrow */}
          <svg className="h-5 w-5 flex-shrink-0 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>

          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700">
              <span className="text-sm font-bold text-white">
                {businessName.charAt(0)}
              </span>
            </div>
            {/* Online dot */}
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#1f2c34] bg-emerald-400" />
          </div>

          {/* Name & status */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {businessName} AI
            </p>
            <p className="text-xs text-emerald-400">online</p>
          </div>

          {/* Action icons */}
          <div className="flex items-center gap-4 text-white/60">
            <Video className="h-5 w-5" />
            <Phone className="h-5 w-5" />
            <MoreVertical className="h-5 w-5" />
          </div>
        </div>

        {/* Chat area */}
        <div
          className="flex flex-col gap-2 overflow-y-auto bg-[#0b141a] px-3 py-4"
          style={{
            minHeight: '320px',
            maxHeight: '400px',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        >
          {/* Date chip */}
          <div className="mb-1 flex justify-center">
            <span className="rounded-lg bg-[#1d2a33] px-3 py-1 text-[10px] text-white/40">
              Today
            </span>
          </div>

          {/* Customer message (left) */}
          <div className="flex justify-start">
            <div className="relative max-w-[85%] rounded-lg rounded-tl-none bg-[#1f2c34] px-3 pb-1.5 pt-2 shadow-sm">
              <p className="text-[13px] leading-relaxed text-white/90">
                {conversation.question}
              </p>
              <div className="mt-0.5 flex items-center justify-end gap-1">
                <span className="text-[10px] text-white/30">12:34</span>
              </div>
              {/* Tail */}
              <div className="absolute -left-2 top-0 h-0 w-0 border-r-8 border-t-8 border-r-transparent border-t-[#1f2c34]" />
            </div>
          </div>

          {/* Typing indicator */}
          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="flex justify-end"
              >
                <div className="rounded-lg rounded-tr-none bg-[#005c4b] px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                      className="h-2 w-2 rounded-full bg-white/60"
                    />
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                      className="h-2 w-2 rounded-full bg-white/60"
                    />
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                      className="h-2 w-2 rounded-full bg-white/60"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI response (right) */}
          <AnimatePresence mode="wait">
            {showResponse && !isTyping && (
              <motion.div
                key={`${industry}-${personality}`}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 30,
                }}
                className="flex justify-end"
              >
                <div className="relative max-w-[85%] rounded-lg rounded-tr-none bg-[#005c4b] px-3 pb-1.5 pt-2 shadow-sm">
                  <p className="text-[13px] leading-relaxed text-white/90">
                    {conversation.answer}
                  </p>
                  <div className="mt-0.5 flex items-center justify-end gap-1">
                    <span className="text-[10px] text-white/30">12:34</span>
                    <CheckCheck className="h-3 w-3 text-blue-400" />
                  </div>
                  {/* Tail */}
                  <div className="absolute -right-2 top-0 h-0 w-0 border-l-8 border-t-8 border-l-transparent border-t-[#005c4b]" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={chatEndRef} />
        </div>

        {/* Bottom input bar */}
        <div className="flex items-center gap-2 bg-[#1f2c34] px-3 py-2.5">
          <div className="flex flex-1 items-center rounded-full bg-[#2a3942] px-4 py-2">
            <span className="text-xs text-white/30">Type a message</span>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600">
            <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
          </div>
        </div>

        {/* Home indicator */}
        <div className="flex justify-center bg-[#0b141a] pb-2 pt-1">
          <div className="h-1 w-28 rounded-full bg-white/20" />
        </div>
      </div>
    </div>
  )
}

/** Map industry slug to a friendly business display name */
function getBusinessName(industry: string): string {
  const names: Record<string, string> = {
    plumber: 'Quick Plumb',
    electrician: 'Spark Electric',
    builder: 'Apex Builders',
    landscaper: 'Green Spaces',
    roofer: 'Peak Roofing',
    gardener: 'Bloom Gardens',
    fencing: 'Solid Fencing',
    paving: 'Premier Paving',
    decking: 'Deck Masters',
    'tree-surgeon': 'Canopy Tree Care',
    cleaner: 'Crystal Clean',
    dental: 'Bright Smiles',
    'estate-agent': 'HomeMove',
    solicitor: 'Clarke & Co',
    recruitment: 'Apex Recruit',
    'hair-salon': 'Style Studio',
    'dog-groomer': 'Pawfect Groom',
  }
  return names[industry] || 'Your Business'
}
