'use client'

import { motion } from 'motion/react'
import { CheckCircle, Sparkles, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function SignupSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0e1a]">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px] animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-emerald-500/15 blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md mx-4 relative z-10"
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Sparkles size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">Nexley AI</span>
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl text-center"
          style={{ background: 'rgba(30, 41, 59, 0.7)' }}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.4 }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle size={32} className="text-emerald-400" />
            </div>
          </motion.div>

          <h1 className="text-xl font-semibold mb-2 text-white">Payment successful</h1>
          <p className="text-sm text-slate-400 mb-6">
            Your subscription is active. Check your email for a magic link to access your dashboard and set up your AI Employee.
          </p>

          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold text-white transition-all bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
          >
            Go to sign in
            <ArrowRight size={16} />
          </Link>
        </motion.div>

        <p className="text-center text-xs mt-6 text-slate-500">
          Didn&apos;t get the email? Check your spam folder or sign in to request a new link.
        </p>
      </motion.div>
    </div>
  )
}
