import type { Session, Source, Suggestion, Workflow, Command, MentionCustomer } from './types';

// Mock data + simulated reply flow (port of lib/mock.jsx from the prototype).

const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

export const SEED_SOURCES: Record<string, Source> = {
  sarahQuote: {
    id: 'q127',
    type: 'quote',
    label: 'Quote #127',
    sublabel: 'Sarah Barker · £2,400 · 3d open',
    details: {
      customer: 'Sarah Barker',
      total: '£2,400.00',
      status: 'Awaiting response',
      sent: daysAgo(3),
      lineItems: [
        { desc: 'Supply & install 18m close-board fencing', qty: '18m', price: '£1,620.00' },
        { desc: 'Concrete posts (x10)', qty: '10', price: '£420.00' },
        { desc: 'Gravel boards', qty: '9', price: '£180.00' },
        { desc: 'Labour — 2 days', qty: '2d', price: '£180.00' },
      ],
    },
  },
  callLog42: {
    id: 'c42',
    type: 'call',
    label: 'Call · 9 min',
    sublabel: 'Sarah Barker · Tuesday 10:42',
    details: {
      contact: 'Sarah Barker',
      when: daysAgo(2),
      duration: '9m 14s',
      sentiment: 'Positive',
      transcript: [
        { who: 'Dave', line: "Hi Sarah, it's Dave from Failsworth — got a minute?" },
        { who: 'Sarah', line: 'Yeah, go on.' },
        { who: 'Dave', line: 'Just wanted to check you got the quote through alright?' },
        { who: 'Sarah', line: "I did, thanks. We're still deciding on the gravel boards." },
        { who: 'Dave', line: 'No worries. I can do a version without if it helps.' },
        { who: 'Sarah', line: "That'd be great actually. Send it over when you can." },
      ],
    },
  },
  contactSarah: {
    id: 'contact-sb',
    type: 'contact',
    label: 'Sarah Barker',
    sublabel: 'Customer · 4 jobs',
    details: {
      name: 'Sarah Barker',
      phone: '07700 900 142',
      email: 'sarah.barker@example.com',
      lastContact: daysAgo(2),
      tags: ['Residential', 'Fencing', 'Repeat'],
      interactions: [
        { when: daysAgo(2), kind: 'Call', note: '9min — quote follow-up' },
        { when: daysAgo(3), kind: 'Quote sent', note: '#127 — £2,400 fencing' },
        { when: daysAgo(18), kind: 'Job complete', note: 'Patio re-lay — £1,180' },
        { when: daysAgo(42), kind: 'Invoice paid', note: '#INV-0844 — £1,180' },
      ],
    },
  },
  pipelineJobs: {
    id: 'pipe-week',
    type: 'job',
    label: 'Pipeline · 3 open',
    sublabel: 'Week to date',
    details: {
      jobs: [
        { customer: 'Sarah Barker', value: '£2,400', stage: 'Quote sent', days: 3 },
        { customer: 'Tom & Marie Ellis', value: '£5,800', stage: 'Site visit booked', days: 1 },
        { customer: 'Redway Property Mgmt', value: '£6,620', stage: 'Quote sent', days: 8 },
      ],
    },
  },
  invoiceCpc: {
    id: 'inv-cpc',
    type: 'invoice',
    label: 'INV-0867',
    sublabel: 'CPC Construction · £3,480',
    details: {
      customer: 'CPC Construction',
      total: '£3,480.00',
      status: 'Draft',
      lineItems: [
        { desc: 'Commercial planting — phase 2', qty: '1', price: '£2,800.00' },
        { desc: 'Bark mulch delivery', qty: '6m³', price: '£480.00' },
        { desc: 'Disposal — green waste', qty: '1', price: '£200.00' },
      ],
    },
  },
};

const PIPELINE_REPLY = `You sent **8 quotes** this week totalling **£14,820**. Here's the breakdown.

## This week at a glance

| Status | Count | Value |
|---|---|---|
| Accepted | 3 | £5,200 |
| Pending > 1 week | 2 | £4,900 |
| Sent in last 48h | 3 | £4,720 |

## Worth your attention

- **Sarah Barker** — quote #127 for fencing, **£2,400**. Last spoke Tuesday. She asked for a version without gravel boards — not sent yet.
- **Redway Property Mgmt** — quote sent 8 days ago, £6,620. No response, no follow-up logged.
- **Tom & Marie Ellis** — site visit booked tomorrow 10:00. Don't forget to bring the soil samples.

## Suggested next step

Send Sarah the revised quote without gravel boards. Draft is ready when you are — just say the word.`;

const MISSED_CALLS_REPLY = `You missed **4 calls** yesterday. Here's what looks worth returning.

- **Marie Ellis** — 16:22, left voicemail. Wants to move Friday's site visit earlier. *Return within the hour.*
- **Unknown 07412 …** — 14:08, no voicemail. Called twice.
- **CPC Construction (Jen)** — 11:45, no voicemail. Likely about INV-0867 which is still in draft.
- **Redway Property** — 09:33, left voicemail: "checking in on the fence quote."

> Two of these are chasing things already in your pipeline — worth a 15-minute block this afternoon to clear all four.`;

const NUDGE_DRAFT_REPLY = `Here's a polite nudge for Sarah — short, no pressure, and references what she asked about:

\`\`\`
Hi Sarah,

Quick one — following up on the fencing quote I sent Friday (#127, £2,400).
You mentioned you were weighing up the gravel boards. Happy to send a
revised version without them if it'd help you decide — just let me know.

No rush either way. Hope the garden survived the weekend's wind.

Dave
Failsworth Landscapes
\`\`\`

Want me to send it as an SMS, email, or both? I can also prepare the revised quote alongside if useful.`;

export const SEED_SESSIONS: Session[] = [
  {
    id: 's1',
    title: 'Pipeline status this week',
    createdAt: hoursAgo(2),
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: hoursAgo(2),
        status: 'done',
        content: 'How many quotes did I send this week and which ones are worth chasing?',
      },
      {
        id: 'm2',
        role: 'assistant',
        createdAt: hoursAgo(2),
        status: 'done',
        content: PIPELINE_REPLY,
        sources: [SEED_SOURCES.sarahQuote, SEED_SOURCES.callLog42, SEED_SOURCES.pipelineJobs, SEED_SOURCES.contactSarah],
      },
    ],
  },
  {
    id: 's2',
    title: "Yesterday's missed calls",
    createdAt: hoursAgo(20),
    messages: [
      {
        id: 'm3',
        role: 'user',
        createdAt: hoursAgo(20),
        status: 'done',
        content: "Show me yesterday's missed calls.",
      },
      {
        id: 'm4',
        role: 'assistant',
        createdAt: hoursAgo(20),
        status: 'done',
        content: MISSED_CALLS_REPLY,
        sources: [SEED_SOURCES.callLog42, SEED_SOURCES.invoiceCpc, SEED_SOURCES.contactSarah],
      },
    ],
  },
  {
    id: 's3',
    title: 'Draft nudge to Sarah Barker',
    createdAt: daysAgo(1),
    messages: [
      {
        id: 'm5',
        role: 'user',
        createdAt: daysAgo(1),
        status: 'done',
        content: 'Draft a polite nudge to Sarah Barker about quote #127.',
      },
      {
        id: 'm6',
        role: 'assistant',
        createdAt: daysAgo(1),
        status: 'done',
        content: NUDGE_DRAFT_REPLY,
        sources: [SEED_SOURCES.sarahQuote, SEED_SOURCES.contactSarah, SEED_SOURCES.callLog42],
      },
    ],
  },
  {
    id: 's4',
    title: 'Invoice draft for CPC',
    createdAt: daysAgo(2),
    messages: [
      {
        id: 'm7',
        role: 'user',
        createdAt: daysAgo(2),
        status: 'done',
        content: 'Draft an invoice for the CPC Construction planting job.',
      },
      {
        id: 'm8',
        role: 'assistant',
        createdAt: daysAgo(2),
        status: 'done',
        content:
          'Drafted invoice **INV-0867** for CPC Construction — **£3,480.00**.\n\nThree line items from the job ticket, 30-day terms as per their preference. It\'s sitting in drafts; review and send when you\'re ready.',
        sources: [SEED_SOURCES.invoiceCpc],
      },
    ],
  },
  {
    id: 's5',
    title: 'Materials for Ellis job',
    createdAt: daysAgo(3),
    messages: [
      { id: 'm9', role: 'user', createdAt: daysAgo(3), status: 'done', content: 'What materials did we use on the Ellis patio job?' },
      {
        id: 'm10',
        role: 'assistant',
        createdAt: daysAgo(3),
        status: 'done',
        content:
          'Indian sandstone (24m²), MOT Type 1 (3.6t), sharp sand (1.2t), bedding mortar, and pointing compound. Totalled £1,180 in materials. Want the supplier list too?',
      },
    ],
  },
  {
    id: 's6',
    title: 'Customers not contacted in 14+ days',
    createdAt: daysAgo(5),
    messages: [
      { id: 'm11', role: 'user', createdAt: daysAgo(5), status: 'done', content: "Which customers haven't heard from me in 14+ days?" },
      {
        id: 'm12',
        role: 'assistant',
        createdAt: daysAgo(5),
        status: 'done',
        content:
          '6 customers. Top 3 by pipeline value: Redway Property (£6,620 open), Delph Care Homes (£4,200 open), and Tom Ashcroft (past customer, no open work).',
      },
    ],
  },
  {
    id: 's7',
    title: "Summarise Friday's site visits",
    createdAt: daysAgo(7),
    messages: [
      { id: 'm13', role: 'user', createdAt: daysAgo(7), status: 'done', content: "Summarise Friday's site visits." },
      {
        id: 'm14',
        role: 'assistant',
        createdAt: daysAgo(7),
        status: 'done',
        content:
          'Three visits on Friday — Barker (fencing measure-up), Ellis (patio consult), Redway (driveway walk-through).',
      },
    ],
  },
  {
    id: 's8',
    title: 'Weekly revenue report',
    createdAt: daysAgo(10),
    messages: [
      { id: 'm15', role: 'user', createdAt: daysAgo(10), status: 'done', content: 'Weekly revenue.' },
      { id: 'm16', role: 'assistant', createdAt: daysAgo(10), status: 'done', content: 'Invoiced £9,240 last week across 5 jobs.' },
    ],
  },
];

export const SUGGESTIONS: Suggestion[] = [
  { prompt: "What's my pipeline look like this week?", category: 'Sales' },
  { prompt: "Who haven't I called in 14+ days?", category: 'Follow-ups' },
  { prompt: 'Draft a polite nudge for my oldest open quote', category: 'Drafting' },
  { prompt: "Show yesterday's missed calls", category: 'Daily' },
];

export const WORKFLOWS: Workflow[] = [
  { title: 'Chase overdue quotes', sub: 'Drafts polite follow-ups for all quotes open > 7 days', steps: 3, kind: 'Draft' },
  { title: 'Morning briefing', sub: "Today's calls, visits, and anything needing attention first", steps: 2, kind: 'Review' },
  { title: 'End-of-day wrap', sub: "Logs today's calls and drafts tomorrow's priorities", steps: 4, kind: 'Log' },
  { title: 'Monthly cashflow view', sub: 'Invoices sent, paid, overdue — with chase drafts ready', steps: 3, kind: 'Report' },
];

export const COMMANDS: Command[] = [
  { id: 'cmd-refine', label: '/refine', sub: 'Improve the clarity of your prompt', icon: 'Sparkles' },
  { id: 'cmd-export', label: '/export', sub: 'Export this conversation', icon: 'Download' },
  { id: 'cmd-clear', label: '/clear', sub: 'Start a fresh session', icon: 'Eraser' },
  { id: 'cmd-history', label: '/history', sub: 'Search across all past sessions', icon: 'History' },
];

export const MENTION_CUSTOMERS: MentionCustomer[] = [
  { id: 'c1', name: 'Sarah Barker', sub: 'Customer · 4 jobs' },
  { id: 'c2', name: 'Tom & Marie Ellis', sub: 'Customer · 2 jobs' },
  { id: 'c3', name: 'Redway Property Mgmt', sub: 'Commercial · 6 jobs' },
  { id: 'c4', name: 'CPC Construction', sub: 'Commercial · 11 jobs' },
  { id: 'c5', name: 'Delph Care Homes', sub: 'Commercial · 3 jobs' },
];

const MOCK_STREAM_REPLIES = [
  `Good question. Let me pull the numbers together.\n\nYou've logged **£14,820** in quotes this week across 8 prospects. Three accepted, two have been sitting open for over a week, and three went out in the last 48 hours.\n\nThe one I'd chase first is **Sarah Barker** — her £2,400 fencing quote has been open three days and she asked on the call for a version without gravel boards, which hasn't gone out yet.`,
  `I've checked across calls, quotes and invoices.\n\nThere are **6 customers** you haven't been in touch with for over two weeks. The three most valuable:\n\n- **Redway Property Mgmt** — £6,620 quote open, 8 days silent\n- **Delph Care Homes** — £4,200 quote, 17 days silent\n- **Tom Ashcroft** — past customer, last job 23 days ago\n\nWant me to draft quick nudges for any of them?`,
  `Here's a draft. Short, warm, no pressure — and it references what she actually asked for on the call.\n\n> Hi Sarah — following up on the fencing quote (#127, £2,400). You mentioned you were weighing up the gravel boards. I can send a version without them if that'd help. No rush.\n>\n> Dave`,
];

export function pickReply(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('pipeline') || p.includes('quote')) return MOCK_STREAM_REPLIES[0];
  if (p.includes('14') || p.includes('haven') || p.includes('follow')) return MOCK_STREAM_REPLIES[1];
  if (p.includes('draft') || p.includes('nudge') || p.includes('sarah')) return MOCK_STREAM_REPLIES[2];
  return MOCK_STREAM_REPLIES[Math.floor(Math.random() * MOCK_STREAM_REPLIES.length)];
}

export function pickSources(prompt: string): Source[] {
  const p = prompt.toLowerCase();
  if (p.includes('pipeline') || p.includes('quote'))
    return [SEED_SOURCES.sarahQuote, SEED_SOURCES.pipelineJobs, SEED_SOURCES.callLog42];
  if (p.includes('sarah') || p.includes('nudge') || p.includes('draft'))
    return [SEED_SOURCES.sarahQuote, SEED_SOURCES.contactSarah];
  if (p.includes('invoice') || p.includes('cpc')) return [SEED_SOURCES.invoiceCpc];
  return [SEED_SOURCES.contactSarah, SEED_SOURCES.pipelineJobs];
}

/* ============================================================
   Feature data used by Views.jsx / Overlays.jsx port
   ============================================================ */

export const PIPELINE_CITED = [
  {
    type: 'p',
    sentences: [
      { text: 'You sent 8 quotes this week totalling £14,820.', cite: 'pipe-week' },
      { text: "Here's what I found worth your attention.", cite: null },
    ],
  },
  { type: 'h3', text: 'Worth your attention' },
  {
    type: 'list',
    items: [
      {
        sentences: [
          { text: "Sarah Barker's £2,400 fencing quote (#127) has been open 3 days.", cite: 'q127' },
          { text: 'On your Tuesday call she asked for a version without gravel boards, which has not been sent yet.', cite: 'c42' },
        ],
      },
      {
        sentences: [
          { text: 'Redway Property Mgmt — £6,620 quote sent 8 days ago with no response and no follow-up logged.', cite: 'pipe-week' },
        ],
      },
      {
        sentences: [
          { text: 'Tom & Marie Ellis have a site visit tomorrow at 10:00.', cite: 'pipe-week' },
          { text: 'Bring the soil samples they asked about on the last visit.', cite: null },
        ],
      },
    ],
  },
  {
    type: 'p',
    sentences: [
      { text: 'The fastest win is sending Sarah the revised quote without gravel boards.', cite: 'c42' },
      { text: "Say the word and I'll draft it.", cite: null },
    ],
  },
];

export const PIPELINE_VERSIONS = [
  { label: 'Initial · 2h ago', paragraphs: PIPELINE_CITED },
  {
    label: 'Revised · 1h ago',
    paragraphs: PIPELINE_CITED.map((p, i) =>
      i === 0
        ? {
            type: 'p',
            sentences: [
              { text: 'Eight quotes this week, £14,820 total.', cite: 'pipe-week' },
              { text: 'Three need your attention today.', cite: null },
            ],
          }
        : p
    ),
  },
];

export const NUDGE_DIFF = [
  { op: 'eq' as const, text: 'Hi Sarah,\n\nQuick one — following up on the fencing quote ' },
  { op: 'del' as const, text: 'I sent Friday ' },
  { op: 'ins' as const, text: 'from Friday ' },
  { op: 'eq' as const, text: '(#127, £2,400). You mentioned ' },
  { op: 'del' as const, text: 'you were weighing up ' },
  { op: 'ins' as const, text: 'wanting to reconsider ' },
  { op: 'eq' as const, text: 'the gravel boards. Happy to send a revised version without them ' },
  { op: 'del' as const, text: "if it'd help you decide " },
  { op: 'ins' as const, text: 'if that would help ' },
  {
    op: 'eq' as const,
    text: "— just let me know.\n\nNo rush either way. Hope the garden survived the weekend's wind.\n\nDave\nFailsworth Landscapes",
  },
];

export const NUDGE_VERSIONS = [{ label: 'First draft' }, { label: 'Tightened' }, { label: 'With subject' }];

export const REVIEW_TABLE_PIPELINE = {
  title: 'Quote review — this week',
  rowHeader: 'Customer',
  columns: ['Amount', 'Status', 'Last contact', 'Suggested action'],
  verifiedDefault: ['0:0', '0:1'],
  rows: [
    {
      label: 'Sarah Barker',
      cells: [
        {
          value: '£2,400',
          bar: 2400,
          barMax: 6620,
          reasoning: 'Extracted from quote #127 line-item subtotal before VAT. Matches CRM deal value.',
          source: SEED_SOURCES.sarahQuote,
        },
        {
          value: 'Awaiting response',
          reasoning: 'No reply logged since quote sent 3 days ago; last activity was a Tuesday call.',
          source: SEED_SOURCES.callLog42,
        },
        {
          value: '2 days ago',
          reasoning: '9-minute call, positive sentiment. Sarah asked for a gravel-board-free revision.',
          source: SEED_SOURCES.callLog42,
        },
        {
          value: 'Send revised quote',
          reasoning: 'Call transcript shows an explicit request that has not been fulfilled — highest-confidence next action.',
          source: SEED_SOURCES.callLog42,
        },
      ],
    },
    {
      label: 'Redway Property',
      cells: [
        {
          value: '£6,620',
          bar: 6620,
          barMax: 6620,
          reasoning: 'Sum of three line items in the commercial quote; matches CRM.',
          source: SEED_SOURCES.pipelineJobs,
        },
        {
          value: 'Silent 8d',
          reasoning: 'No inbound/outbound contact in 8 days. Quote still marked sent.',
          source: SEED_SOURCES.pipelineJobs,
        },
        {
          value: '8 days ago',
          reasoning: 'Quote email delivery confirmed; no reply.',
          source: SEED_SOURCES.pipelineJobs,
        },
        {
          value: 'Polite nudge',
          reasoning: 'Standard 7-day SLA exceeded. Medium-confidence follow-up.',
          source: SEED_SOURCES.pipelineJobs,
        },
      ],
    },
    {
      label: 'Tom & Marie Ellis',
      cells: [
        {
          value: '£5,800',
          bar: 5800,
          barMax: 6620,
          reasoning: 'Quote not yet sent; figure from site-visit estimate.',
          source: SEED_SOURCES.pipelineJobs,
        },
        {
          value: 'Site visit booked',
          reasoning: 'Calendar event confirmed for 10:00 tomorrow.',
          source: SEED_SOURCES.pipelineJobs,
        },
        {
          value: 'Yesterday',
          reasoning: 'Marie called to shift the visit earlier; left a voicemail.',
          source: SEED_SOURCES.contactSarah,
        },
        { value: 'Prep soil samples', reasoning: 'Previous site notes flagged soil-type uncertainty.', source: null },
      ],
    },
  ],
};

export const PIPELINE_RECEIPT = {
  savedHours: '2.4h',
  sourcesCited: '4',
  verified: '0 of 12',
  verifiedSub: 'review table',
  modelCalls: '47',
  modelSub: '41 Haiku · 6 Opus',
};

export const NUDGE_RECEIPT = {
  savedHours: '18m',
  sourcesCited: '3',
  verified: 'Voice',
  verifiedSub: 'Failsworth style',
  modelCalls: '12',
  modelSub: '11 Haiku · 1 Opus',
};

// Silence unused helper warnings at dev time
void minsAgo;
