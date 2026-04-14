import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Security & Trust | Nexley AI',
  description: 'How Nexley AI secures your data — SOC 2 certified infrastructure, GDPR compliant, end-to-end encrypted tokens.',
}

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-[#0a0e1a] text-slate-100">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← Back</Link>
        <h1 className="mt-6 text-3xl font-bold">Security &amp; Trust</h1>
        <p className="mt-3 text-slate-400 text-sm">
          No security product is ever &ldquo;100% secure.&rdquo; What we can give you is a
          clear, audit-backed picture of how your data is handled and who is
          accountable at every layer.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Certifications in our supply chain</h2>
          <p className="text-sm text-slate-300">
            Every piece of infrastructure Nexley AI depends on is independently
            audited:
          </p>
          <ul className="text-sm text-slate-300 space-y-2 list-disc pl-6">
            <li>
              <strong>Supabase</strong> — SOC 2 Type 2 certified; HIPAA compliant;
              ISO 27001 in progress. Encrypts data at rest (AES-256) and in
              transit (TLS 1.3). Hosts your contacts, call logs, integrations.
            </li>
            <li>
              <strong>Composio</strong> — SOC 2 Type 2 certified; end-to-end
              encrypted OAuth tokens; zero-day log retention. Holds the tokens
              that let your AI Employee send emails, book calendars, etc.
            </li>
            <li>
              <strong>Vercel</strong> — SOC 2 Type 2 + ISO 27001. Hosts the
              dashboard.
            </li>
            <li>
              <strong>Hetzner</strong> — ISO 27001 certified. Each client runs on a dedicated EU-region VPS.
            </li>
            <li>
              <strong>Anthropic (Claude)</strong> — SOC 2 Type 2. The language
              model behind the AI Employee.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Data handling</h2>
          <ul className="text-sm text-slate-300 space-y-2 list-disc pl-6">
            <li>Integration OAuth tokens never sit in our database. Composio stores them encrypted; we only hold a connection ID.</li>
            <li>Every client&rsquo;s data is isolated to their own VPS and their own Composio user scope — one client&rsquo;s agent can never see another client&rsquo;s tools.</li>
            <li>Database access is gated by Row-Level Security tied to a scoped JWT. No shared service-role keys in client environments.</li>
            <li>Dashboard sessions use Supabase magic links (no passwords) — nothing for an attacker to phish.</li>
            <li>Zero data training. We never use client data to train AI models.</li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">GDPR &amp; DPA</h2>
          <p className="text-sm text-slate-300">
            Nexley AI is a <strong>data processor</strong> acting on your
            instructions. We sign a Data Processing Agreement before onboarding
            and are registered with the UK ICO. Ask
            {' '}<a href="mailto:legal@nexley.ai" className="text-indigo-400 hover:text-indigo-300">legal@nexley.ai</a>{' '}
            for our DPA template.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Uptime</h2>
          <p className="text-sm text-slate-300">
            We target <strong>99.5% uptime</strong> on the AI Employee service
            — industry norm for AI-LLM systems is 99.3% (source: Anthropic
            status dashboard shows ~5h downtime/month). Our agents run with
            model failover (Opus → Sonnet 4.6), per-minute health monitoring,
            automatic restart on failure, and human escalation inside 15
            minutes when anything breaks.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Responsible disclosure</h2>
          <p className="text-sm text-slate-300">
            Found something? Email{' '}
            <a href="mailto:security@nexley.ai" className="text-indigo-400 hover:text-indigo-300">security@nexley.ai</a>.
            We triage within one business day, resolve criticals within 72
            hours, and credit reporters (with permission) in the
            acknowledgements section.
          </p>
          <p className="text-xs text-slate-500">
            See <a href="/.well-known/security.txt" className="underline">/.well-known/security.txt</a>
          </p>
        </section>

        <section id="acknowledgements" className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Acknowledgements</h2>
          <p className="text-sm text-slate-400">No researchers yet — be the first.</p>
        </section>

        <p className="mt-16 text-xs text-slate-500">
          Last updated: 2026-04-14.
        </p>
      </div>
    </main>
  )
}
