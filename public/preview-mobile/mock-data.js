// Mock data for Varley Electrical Ltd
// Used across Home, Chat, Inbox, Conversation detail

const NX_MOCK = {
  business: {
    name: 'Varley Electrical Ltd',
    owner: 'Tom Varley',
    firstName: 'Tom',
    vps: {
      hostname: 'varley-electrical-ltd',
      ip: '195.201.43.218',
      uptimeHours: 4,
      uptimeMins: 12,
    },
  },

  // This week's tally — matches roi.breakdown so the metric cards and the
  // ROI hero never tell different stories. (Devil's-advocate fix: these
  // were "today" while the hero was "this week" — confusing.)
  digest: {
    messages: 41,
    calls: 8,
    bookings: 3,
    awaitingReply: 2,
    period: 'this week',
  },

  // ROI hero — measured in TIME (hours), not pretend-salary money.
  // Time is the unit a working tradesperson actually feels: it's evenings back,
  // not a fairy-tale comparison to hiring an admin.
  roi: {
    hoursSaved: 6.4,            // total hours this week
    minutesSavedToday: 38,      // small "today" pill
    deltaPctVsLastWeek: 22,     // +22% vs. last week
    breakdown: [
      { label: 'Messages handled',  count: 41, perItemMin: 4,  totalMin: 164 },
      { label: 'Calls answered',    count: 8,  perItemMin: 9,  totalMin: 72  },
      { label: 'Bookings made',     count: 3,  perItemMin: 47, totalMin: 142 },
    ],                          // sums to 378 min ≈ 6.3h
    sparkline: [38, 52, 41, 67, 78, 56, 92], // minutes/day, Mon→Sun
  },

  // Recent activity feed (last 5)
  activity: [
    { id: 'a1', type: 'reply', icon: 'message', text: 'Replied to Sarah Mitchell about kitchen rewire', time: '2m ago' },
    { id: 'a2', type: 'booking', icon: 'calendar', text: 'Booked James O\'Brien — consumer unit upgrade, Thu 10:00', time: '14m ago' },
    { id: 'a3', type: 'estimate', icon: 'file', text: 'Drafted estimate for Priya Shah — £1,240 (awaiting approval)', time: '38m ago' },
    { id: 'a4', type: 'call', icon: 'phone', text: 'Answered missed call from Daniel Hughes — left voicemail', time: '1h ago' },
    { id: 'a5', type: 'reply', icon: 'message', text: 'Replied to Hannah Webb about EICR quote turnaround', time: '2h ago' },
  ],

  // Customer conversation list (Inbox)
  conversations: [
    {
      id: 'c1', name: 'Sarah Mitchell', initials: 'SM', channel: 'whatsapp',
      preview: 'Brilliant — Tuesday morning works for me. Shall I send through the floor plan?',
      time: '2m', unread: 0, status: 'awaiting_reply',
    },
    {
      id: 'c2', name: 'James O\'Brien', initials: 'JO', channel: 'whatsapp',
      preview: 'Nexley: Booked you in for Thursday at 10:00. I\'ll send a calendar invite shortly.',
      time: '14m', unread: 0, status: 'booked',
    },
    {
      id: 'c3', name: 'Priya Shah', initials: 'PS', channel: 'sms',
      preview: 'Could you send a written quote? My landlord needs it for the file.',
      time: '38m', unread: 2, status: 'awaiting_reply',
    },
    {
      id: 'c4', name: 'Daniel Hughes', initials: 'DH', channel: 'phone',
      preview: 'Voicemail — 47s · "Hi, calling about the outdoor lighting quote..."',
      time: '1h', unread: 1, status: 'new',
    },
    {
      id: 'c5', name: 'Hannah Webb', initials: 'HW', channel: 'whatsapp',
      preview: 'Perfect, thanks. See you next week!',
      time: '2h', unread: 0, status: 'closed',
    },
    {
      id: 'c6', name: 'Marcus Allen', initials: 'MA', channel: 'whatsapp',
      preview: 'Nexley: I\'ve attached the EICR certificate. Let me know if you need anything else.',
      time: '4h', unread: 0, status: 'closed',
    },
    {
      id: 'c7', name: 'Olivia Bennett', initials: 'OB', channel: 'sms',
      preview: 'Yes please book it in — Friday afternoon if you have anything.',
      time: '6h', unread: 0, status: 'booked',
    },
    {
      id: 'c8', name: 'Rashid Khan', initials: 'RK', channel: 'whatsapp',
      preview: 'Cheers Tom — payment sent.',
      time: 'yest', unread: 0, status: 'closed',
    },
  ],

  // Sarah Mitchell thread (Conversation detail) — kept as `thread` for back-compat;
  // also indexed in `threadsById` for per-conversation routing.
  thread: {
    customerId: 'c1',
    customerName: 'Sarah Mitchell',
    initials: 'SM',
    channel: 'whatsapp',
    phone: '+44 7890 442 198',
    location: 'Hampstead, NW3',
    messages: [
      { id: 'm1', role: 'customer', text: 'Hi — looking for a quote on rewiring the kitchen and adding a couple of pendants over the island. Are you taking on work in NW3?', time: '18:42' },
      { id: 'm2', role: 'ai', text: 'Hi Sarah — yes, we cover NW3. To put together an accurate quote I\'ll need a few details: rough size of the kitchen, current circuit (is the consumer unit modern or pre-2008?), and whether the pendants need new chases or can run surface.', time: '18:43', tools: [{ tool: 'check_service_area', label: 'Checked service area — NW3 covered', status: 'done' }] },
      { id: 'm3', role: 'customer', text: 'Kitchen is about 4m × 5m. CU was replaced two years ago — Hager I think. Happy with chases, walls are coming back anyway.', time: '18:51' },
      { id: 'm4', role: 'ai', text: 'Perfect. Based on similar jobs in your area, you\'re looking at £1,180–£1,420 for a full kitchen rewire including the two pendants over the island. That includes 6 sockets, a fused spur for the dishwasher, and certification. Tom (the owner) typically does a 30-min site visit before confirming — would Tuesday morning suit?', time: '18:55', tools: [{ tool: 'price_lookup', label: 'Pulled from 14 similar jobs', status: 'done' }, { tool: 'check_calendar', label: 'Checked Tom\'s calendar', status: 'done' }] },
      { id: 'm5', role: 'customer', text: 'Brilliant — Tuesday morning works for me. Shall I send through the floor plan?', time: '2m ago' },
    ],
  },

  // Chat with Nexley (the owner's AI Employee chat)
  ownerChat: [
    { id: 'oc1', role: 'owner', text: 'How did this week go?', time: '09:41' },
    { id: 'oc2', role: 'ai', tools: [
        { tool: 'read_inbox', label: 'Read 41 messages', status: 'done' },
        { tool: 'read_calendar', label: 'Checked 8 bookings', status: 'done' },
        { tool: 'read_estimates', label: 'Read 3 estimates', status: 'done' },
      ],
      text: 'Solid week, Tom. Quick read:\n\n• 41 messages, 8 calls, 3 new bookings\n• Saved you 6h 24m of admin — about 1.3h per working day\n• 2 customers still waiting on you — Sarah Mitchell (kitchen rewire, replied yesterday) and Priya Shah (asking for written quote, sent twice)\n• Priya\'s estimate is drafted at £1,240 — needs your sign-off before I send it\n\nWant me to walk through Priya\'s quote?', time: '09:41' },
  ],
};

window.NX_MOCK = NX_MOCK;

// Per-conversation threads. Top three customers get full threads; the rest
// inherit a stub (header + a single customer message + an AI ack) so tapping
// any inbox row routes correctly instead of always landing on Sarah's view.
NX_MOCK.threadsById = {
  c1: NX_MOCK.thread, // Sarah — the rich one
  c2: {
    customerId: 'c2',
    customerName: "James O'Brien",
    initials: 'JO',
    channel: 'whatsapp',
    phone: '+44 7903 118 244',
    location: 'Camden, NW1',
    messages: [
      { id: 'jo1', role: 'customer', text: 'Hi — landlord asked me to get the consumer unit upgraded. It\'s an old Wylex board, no RCD. How soon could you fit a new one?', time: 'TUE 11:14' },
      { id: 'jo2', role: 'ai', text: 'Hi James — sounds like a standard CU swap. We can do Thursday at 10:00 if that works. Should take 4–5 hours, includes Part P certification. Estimate is £640 incl. VAT.', time: 'TUE 11:18', tools: [{ tool: 'price_lookup', label: 'Pulled CU-swap pricing', status: 'done' }, { tool: 'check_calendar', label: 'Found Thu 10:00 free', status: 'done' }] },
      { id: 'jo3', role: 'customer', text: 'Brilliant, Thursday works.', time: 'TUE 11:22' },
      { id: 'jo4', role: 'ai', text: 'Booked you in for Thursday at 10:00. I\'ll send a calendar invite shortly and Tom will message the night before to confirm.', time: '14m ago', tools: [{ tool: 'create_booking', label: 'Booked Thu 10:00', status: 'done' }, { tool: 'send_invite', label: 'Sent calendar invite', status: 'done' }] },
    ],
  },
  c3: {
    customerId: 'c3',
    customerName: 'Priya Shah',
    initials: 'PS',
    channel: 'sms',
    phone: '+44 7811 552 901',
    location: 'Kentish Town, NW5',
    messages: [
      { id: 'ps1', role: 'customer', text: 'Hi, after a quote for a full kitchen rewire — 5x4m, integrated appliances. My landlord needs it in writing for the file.', time: 'MON 16:08' },
      { id: 'ps2', role: 'ai', text: 'Hi Priya — based on similar jobs in NW5, that comes to £1,180–£1,300 incl. VAT. I\'ve drafted a written quote at £1,240 with a 10-day validity — Tom needs to sign off before I send it your way. Will follow up shortly.', time: 'MON 16:14', tools: [{ tool: 'draft_estimate', label: 'Drafted estimate £1,240', status: 'done' }] },
      { id: 'ps3', role: 'customer', text: 'Could you send a written quote? My landlord needs it for the file.', time: '38m ago' },
    ],
  },
};

// Stub thread for any conversation we don't have a script for — keeps the
// router honest without exploding the data file.
NX_MOCK.threadStub = (c) => ({
  customerId: c.id,
  customerName: c.name,
  initials: c.initials,
  channel: c.channel,
  phone: c.channel === 'phone' ? '+44 7900 000 000' : '+44 7900 ' + (100000 + (c.id.charCodeAt(1) * 137) % 899999),
  location: '',
  messages: [
    { id: c.id + '-stub-1', role: 'customer', text: c.preview.replace(/^Nexley:\s*/, ''), time: c.time },
    { id: c.id + '-stub-2', role: 'ai', text: 'Got it — I\'ll loop Tom in if anything needs his sign-off. Speak soon.', time: c.time, tools: [] },
  ],
});

// ── Integrations (Settings → Integrations) ──
// Each integration has:
//   - svg: mono SVG path data (24×24, stroke or fill, neutral foreground)
//   - svgKind: 'fill' | 'stroke'
//   - capabilities: TERSE verb phrases ("Reads contacts" not "Read your contacts and customer details")
//   - permissions: per-integration toggles tied to capabilities
//   - lastSync varied to look like a real install (not all "2m ago")
NX_MOCK.integrations = [
  // ── Communication ──
  {
    id: 'gmail', name: 'Gmail', group: 'Communication',
    desc: 'Drafts replies to customer emails and sends them from your inbox.',
    capabilities: ['Reads incoming emails', 'Drafts replies', 'Sends quotes & follow-ups'],
    permissions: [
      { id: 'auto_reply',  label: 'Auto-send replies without approval', defaultOn: false },
      { id: 'read_history', label: 'Read email history older than 30 days', defaultOn: true },
    ],
    status: 'connected', account: 'tom@varleyelectrical.co.uk', lastSync: '2m ago',
    suggestion: '"Draft a reply to Priya about the kitchen quote."',
    svgKind: 'fill',
    // Gmail — envelope outline + classic V flap that reads as the "M" wedge.
    // Recognisable at 24px, unlike the bare-M monogram before.
    svg: 'M3 6.5C3 5.67 3.67 5 4.5 5h15c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5h-2v-9.4l-5.5 4.4-5.5-4.4V18h-2C3.67 18 3 17.33 3 16.5v-10z',
  },
  {
    id: 'outlook', name: 'Outlook 365', group: 'Communication',
    desc: 'Same as Gmail — for Microsoft-shop tradespeople.',
    capabilities: ['Reads incoming emails', 'Drafts replies', 'Sends quotes & follow-ups'],
    permissions: [
      { id: 'auto_reply',  label: 'Auto-send replies without approval', defaultOn: false },
    ],
    status: 'disconnected',
    svgKind: 'fill',
    // Outlook — bold "O" with the calendar/file panel beside it. Reads as
    // Outlook far better than the previous hard-drive shape.
    svg: 'M2 7.2C2 6.54 2.54 6 3.2 6h8.6c.66 0 1.2.54 1.2 1.2v9.6c0 .66-.54 1.2-1.2 1.2H3.2C2.54 18 2 17.46 2 16.8V7.2zM7.5 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 1.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM14 8.5h7c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1h-7v-1.5h6v-5h-6V8.5z',
  },

  // ── Calendar ──
  {
    id: 'gcal', name: 'Google Calendar', group: 'Calendar',
    desc: 'Books customer appointments into the right slot.',
    capabilities: ['Reads availability', 'Books appointments', 'Sends invites'],
    permissions: [
      { id: 'auto_book', label: 'Book without confirming with you first', defaultOn: false },
    ],
    status: 'needs_reauth', account: 'tom@varleyelectrical.co.uk',
    reason: 'Sign-in expired · reconnect to keep booking jobs',
    svgKind: 'stroke',
    // Calendar with "31"
    svg: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9h16M8 3v3m8-3v3M9 14h2m4 0h0m-6 3h2',
  },
  {
    id: 'apple_cal', name: 'Apple Calendar', group: 'Calendar',
    desc: 'iCloud calendars via CalDAV.',
    capabilities: ['Reads availability', 'Books appointments', 'Sends invites'],
    permissions: [
      { id: 'auto_book', label: 'Book without confirming with you first', defaultOn: false },
    ],
    status: 'disconnected',
    svgKind: 'fill',
    // Apple-style logo silhouette
    svg: 'M16.5 12.5c0-2.4 2-3.6 2.1-3.6-1.1-1.6-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3-.8 1.5 0 1.8.8 3 .7 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-0-0-2.5-1-2.4-3.8zm-2.4-7c.7-.8 1.2-2 1-3.2-1 0-2.3.7-3 1.5-.6.7-1.3 1.9-1.1 3.1 1.2.1 2.3-.6 3.1-1.4z',
  },

  // ── Accounting ──
  {
    id: 'xero', name: 'Xero', group: 'Accounting',
    desc: 'Quotes, invoices, contacts — UK SMB default.',
    capabilities: ['Pulls customer details', 'Creates draft invoices', 'Marks invoices paid'],
    permissions: [
      { id: 'auto_invoice', label: 'Send invoices on my behalf', defaultOn: true },
      { id: 'auto_chase',   label: 'Chase overdue invoices automatically', defaultOn: false },
    ],
    status: 'connected', account: 'Varley Electrical Ltd', lastSync: '3 days ago',
    suggestion: '"Draft an invoice for James O\'Brien\'s consumer-unit job."',
    svgKind: 'fill',
    // Xero — circle with bold X strokes (the actual mark is a circle with X cutout)
    svg: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-3.2 5.2 3.2 3.2 3.2-3.2 1.4 1.4-3.2 3.2 3.2 3.2-1.4 1.4-3.2-3.2-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4z',
  },
  {
    id: 'quickbooks', name: 'QuickBooks', group: 'Accounting',
    desc: 'For QuickBooks Online users.',
    capabilities: ['Pulls customer details', 'Creates draft invoices', 'Reconciles payments'],
    permissions: [
      { id: 'auto_invoice', label: 'Send invoices on my behalf', defaultOn: true },
    ],
    status: 'disconnected',
    svgKind: 'fill',
    // QuickBooks — circle with the lower-case "qb" lockup. The trailing
    // descender on the q is the recognisable detail.
    svg: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7.5 8a4 4 0 0 0 0 8h.7v2.5l3-2.5h.3v-2H8.2a2 2 0 1 1 0-4h2v6h2V8h-4.7zm5 0v8h2.3a4 4 0 1 0 0-8H12.5zm2 2h.3a2 2 0 1 1 0 4h-.3v-4z',
  },
  {
    id: 'freeagent', name: 'FreeAgent', group: 'Accounting',
    desc: 'UK-native — common with sole traders.',
    capabilities: ['Pulls customer details', 'Creates draft invoices', 'Tracks time on jobs'],
    permissions: [
      { id: 'auto_invoice', label: 'Send invoices on my behalf', defaultOn: true },
    ],
    status: 'disconnected',
    svgKind: 'fill',
    // FreeAgent — bold "F" + slim "A" lockup, recognisable wordmark style.
    svg: 'M5 5h7v2.4H7.4v3.1h4v2.4h-4V19H5V5zm9 0h2.6l3.4 14h-2.5l-.7-3.1h-3l-.7 3.1H11L14 5zm1.3 8.5h2L17.3 9l-1 4.5z',
  },

  // ── Trades operations ──
  {
    id: 'fergus', name: 'Fergus', group: 'Trades operations',
    desc: 'Job management built for tradespeople.',
    capabilities: ['Creates jobs from enquiries', 'Pushes estimates', 'Syncs customer notes'],
    permissions: [
      { id: 'auto_create_job', label: 'Create jobs without my approval', defaultOn: true },
    ],
    status: 'syncing', account: 'Varley Electrical · Owner', lastSync: 'syncing now',
    svgKind: 'fill',
    // Hard-hat / hammer silhouette
    svg: 'M12 3a7 7 0 0 0-7 7v3h14v-3a7 7 0 0 0-7-7zM4 14h16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zm6-9v3h4V5a4 4 0 0 0-4 0z',
  },

  // ── CRM ──
  {
    id: 'hubspot', name: 'HubSpot', group: 'CRM',
    desc: 'If you run leads through HubSpot.',
    capabilities: ['Pushes new contacts', 'Logs conversations', 'Updates deal stages'],
    permissions: [
      { id: 'auto_log', label: 'Log every conversation automatically', defaultOn: true },
    ],
    status: 'failed',
    reason: 'OAuth refresh declined · last worked 6 days ago',
    svgKind: 'stroke',
    // Sprocket-style mark
    svg: 'M12 4v4m0 8v4m4-12 2.8-2.8M5.2 18.8 8 16m8 0 2.8 2.8M5.2 5.2 8 8M4 12h4m8 0h4',
  },

  // ── Productivity ──
  {
    id: 'sheets', name: 'Google Sheets', group: 'Productivity',
    desc: 'Export data on demand — "send me a CSV of jobs this month".',
    capabilities: ['Appends rows', 'Generates weekly summaries', 'Builds reports on request'],
    permissions: [
      { id: 'allow_writes', label: 'Allow writing to existing sheets', defaultOn: true },
    ],
    status: 'disconnected',
    svgKind: 'stroke',
    // Spreadsheet grid
    svg: 'M5 4h14v16H5zM5 9h14M5 14h14M10 4v16M15 4v16',
  },

  // ── Team comms ──
  {
    id: 'slack', name: 'Slack', group: 'Team comms',
    desc: 'Get pinged when something needs you.',
    capabilities: ['Pings on customer escalations', 'Posts daily digest', 'Notifies team on new bookings'],
    permissions: [
      { id: 'dm_only',   label: 'DM me — never post in shared channels', defaultOn: true },
      { id: 'quiet_hrs', label: 'Quiet hours (8pm–7am)', defaultOn: true },
    ],
    status: 'disconnected',
    suggestion: '"Ping me in Slack the next time a customer asks for an emergency callout."',
    svgKind: 'fill',
    // Hash / four-rectangle Slack mark
    svg: 'M5 14a2 2 0 1 1 0-4h2v4zm5 5a2 2 0 1 1-4 0v-2h4zm-1-9a2 2 0 1 1 0-4 2 2 0 0 1 2 2v2zm1 1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2h-6zm9 0a2 2 0 1 1 0 4h-2v-4zm-5-5a2 2 0 1 1 4 0v2h-4zm1 9a2 2 0 1 1 0 4 2 2 0 0 1-2-2v-2zm-1-1a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2h6z',
  },

  // ── Payments ──
  {
    id: 'stripe', name: 'Stripe', group: 'Payments',
    desc: 'Take card payments via SMS or WhatsApp link.',
    capabilities: ['Generates payment links', 'Sends links to customers', 'Marks invoices paid'],
    permissions: [
      { id: 'auto_link', label: 'Send payment links automatically', defaultOn: false },
    ],
    status: 'disconnected',
    svgKind: 'fill',
    // Stripe — bold "S" curve
    svg: 'M13.7 8.6c0-.7-.6-1-1.5-1-1.5 0-3.1.6-3.1 2.4 0 1.5 1.3 2 2.7 2.4 1.4.4 2.6.7 2.6 1.6 0 .8-.7 1.1-1.7 1.1-1.3 0-2.4-.5-3.4-1.1v2.4c1 .5 2.1.8 3.4.8 2.4 0 4-1.1 4-2.9 0-2-1.5-2.5-3-2.9-1.4-.4-2.4-.6-2.4-1.4 0-.6.5-.9 1.4-.9 1.1 0 2.3.4 3 .9V8.2c-.7-.4-1.7-.6-2.7-.6h-.3z',
  },
];

// Demo state flags surfaced in the Tweaks panel so reviewers can see
// every important state without editing the data file. Each flag is read
// at runtime by the corresponding screen.
NX_MOCK.demoFlags = {
  emptyIntegrations: false,    // show "plan doesn't include integrations" empty state
  justConnectedSlack: false,   // pre-mark Slack as just-connected so SuggestionCard appears
  permissivePermissions: false,// "auto-send" is on → Inbox banner changes tone
  freshOnboarding: false,      // Day-0 view: no ROI, empty inbox, integrations all disconnected
};

// First-time-user empty state shown when no integrations are available on the plan.
// Used by IntegrationsScreen when items.length === 0.
NX_MOCK.integrationsEmptyState = {
  enabled: false, // flip true to demo (or use demoFlags.emptyIntegrations from the tweak panel)
  title: 'Integrations are part of the AI Employee plan',
  body: 'Upgrade to connect Gmail, your calendar, and accounting tools so Nexley can act on your behalf.',
  cta: 'See plans',
};
