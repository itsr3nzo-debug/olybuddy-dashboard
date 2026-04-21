# Xero Integration + Composio Dashboard Wiring Plan

**Created:** 2026-04-17
**Status:** Approved pending 5 decisions from Kade
**Estimated effort:** 5–6 engineering days

---

## Part 0 — State audit (what's already built)

| Component | Built? | Notes |
|---|---|---|
| `integrations` table with `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `scope`, status fields | ✅ | 18 columns, production-ready |
| `/api/oauth/[provider]` — handles Composio path + direct-OAuth path | ✅ | Path A = Composio (Gmail/Cal/Slack/HubSpot/QuickBooks/Calendly). Path B = direct (Xero/Sage/FreeAgent). Role-gated to owner/super_admin. |
| `/api/oauth/[provider]/callback` | ✅ | Token exchange + DB persist |
| `/api/oauth/[provider]/disconnect` | ✅ | |
| `IntegrationsPage.tsx` UI | ✅ | Filter, search, provider icons, Connect/Disconnect, status badges |
| `lib/integrations-config.ts` — Xero config | ✅ | `XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` env vars already set in Vercel |
| `lib/composio.ts` — SDK + 118-toolkit registry | ✅ | `composio-registry.json` maps provider → auth config ID |
| Composio env vars for 14 providers | ✅ | Gmail, GCal, Slack, HubSpot, QuickBooks, Calendly, GDrive, Outlook, Teams, Sage, FreeAgent, Fathom, Stripe |
| **Xero API client library (create invoice, payments, reconciliation)** | ❌ | **Doesn't exist — we need to build this** |
| **Xero tool exposed to VPS agent** (Nexley can call Xero) | ❌ | **Doesn't exist — we need to wire this** |
| **UK-specific: CIS tax codes, VAT DRC handling** | ❌ | **Needs logic in invoice-drafting code** |
| **Xero tenant selection** (user may have multiple Xero orgs) | ⚠️ | Need to verify callback handles the `xero-tenant-id` header correctly |
| **End-to-end Composio flow verified on live nexley.vercel.app** | ⚠️ | Wired, but untested post-rename. Needs smoke test. |

---

## Part 1 — Xero (the new build)

### Phase 1.1: Register with Xero (30 min, Kade's action)

1. Sign in to **developer.xero.com** with `kadedillonai56@gmail.com`
2. Create an App → **Web App** type
3. **Company/app name**: `Nexley AI`
4. **Company or app URL**: `https://nexley.vercel.app`
5. **OAuth 2.0 redirect URI**: `https://nexley.vercel.app/api/oauth/xero/callback`
6. **Privacy policy URL**: `https://nexley.vercel.app/privacy`
7. Grab `Client ID` + `Client Secret` → paste into Vercel env
8. Certify later — only needed at 25+ connections

**Tier**: Starter ($0, 5 connections max) for Julian + 4 more clients, then upgrade to Core.

### Phase 1.2: Dashboard — Xero connect flow (1 day)

| File | Action | What |
|---|---|---|
| `lib/integrations-config.ts` | Modify | Set `available: true` on Xero entry; use granular scopes from day 1 (mandatory post-Mar 2026) |
| `app/api/oauth/xero/callback/route.ts` | Verify + patch | Xero returns `id_token` with tenants. Fetch `/connections` endpoint, store `xero_tenant_id` in `integrations.metadata.tenant_id` |
| `components/integrations/IntegrationsPage.tsx` | Verify UI | Xero card already renders via CURATED_PROVIDERS — smoke-test on live |

Granular scopes (minimum viable for trades AI):
```
accounting.transactions
accounting.contacts
accounting.attachments
accounting.reports.read
offline_access
```

### Phase 1.3: Xero API client library (2 days)

Create `lib/integrations/xero.ts`:

```ts
class XeroClient {
  // Auth
  constructor(clientId: string, tenantId: string)
  private async refreshIfExpired(): Promise<void>

  // Reads
  listContacts(search?: string): Promise<Contact[]>
  getContact(contactId: string): Promise<Contact>
  listInvoices(filter?: { status?, dateFrom?, contactId? }): Promise<Invoice[]>
  listOverdueInvoices(): Promise<Invoice[]>
  getInvoicePDF(invoiceId: string): Promise<Buffer>
  listBills(filter?): Promise<Bill[]>
  getBankTransactions(accountId?, dateFrom?): Promise<BankTxn[]>
  getVATReport(periodStart, periodEnd): Promise<VATReport>

  // Writes
  createContact(contact: ContactInput): Promise<Contact>
  createInvoice(invoice: InvoiceInput): Promise<Invoice>
  sendInvoice(invoiceId: string): Promise<void>
  recordPayment(invoiceId, amount, date): Promise<void>
  uploadAttachment(invoiceId, file): Promise<void>

  // UK specifics
  private applyCISIfSubcontractor(invoice, contact)
  private applyVATDRCIfConstruction(invoice, services)
}
```

**UK tax logic (HMRC-liability-safe — updated 2026-04-18):**
- Missing `TaxType` on a line → default to `OUTPUT2` (standard UK 20% VAT). That's the only auto-applied code.
- `ECOUTPUTSERVICES` (Domestic Reverse Charge, DRC) is **NEVER auto-applied**. The owner must set `TaxType: 'ECOUTPUTSERVICES'` explicitly per line before authorising — DRC misclassification is HMRC liability on the supplier. The agent can draft DRC invoices but the route enforces `status=DRAFT` on any invoice with DRC lines (owner reviews + authorises manually).
- CIS (Construction Industry Scheme) is NOT a VAT treatment — it's a PAYE income-tax deduction. The Xero org's accountant handles CIS at the org level; the agent does not touch CIS codes.

### Phase 1.4: Expose Xero to the VPS agent (1 day)

**Option B (recommended)**: Dashboard-proxy pattern. VPS agent calls `/api/agent/xero/*` with its `agent_api_key`; dashboard holds Xero tokens and does the actual Xero call.

Endpoints:
```
POST /api/agent/xero/invoices/create          body: { tenant_id, invoice_data }
GET  /api/agent/xero/invoices/overdue
POST /api/agent/xero/payments/record
GET  /api/agent/xero/contacts/search?q=
POST /api/agent/xero/attachments/upload
```

Auth: `Authorization: Bearer <agent_api_key>` → dashboard validates → looks up that client's Xero tokens → calls Xero.

### Phase 1.5: Wire Xero into Nexley's skills (1 day)

| Skill file | Trigger | What Nexley does |
|---|---|---|
| `draft-xero-invoice.md` | Job marked complete | Pull customer + line items from Fergus / captured-jobs; call dashboard API; draft saved in Xero |
| `check-overdue-invoices.md` | Daily cron | Call `/overdue`; draft WhatsApp nudges for owner approval |
| `record-payment.md` | Customer texts "Paid" or bank match | Call `/payments/record` |
| `xero-context-lookup.md` | Before first reply to new enquiry | Search contact in Xero + surface LTV, last invoice, CIS status |

### Phase 1.6: Test matrix (half day)

- Unit: each `XeroClient` method against Xero sandbox org
- Integration: Julian connects real Xero → Nexley drafts real invoice → Julian approves
- Rate limit: simulate 100 calls/min (Xero limit = 60/min)
- Token refresh: force expired token → verify auto-refresh
- Multi-tenant: connect user with 2 Xero orgs → verify tenant selector
- Granular scopes: verify we only request what we need

**Total Xero effort: ~5–6 engineering days.**

---

## Part 2 — Composio wiring audit (fix + verify)

### Phase 2.1: Smoke-test 14 configured providers (half day)

Each provider → connect → execute one read action → verify response. Fix any callback/scope/auth-config failures.

Providers: Gmail, Google Calendar, Slack, HubSpot, QuickBooks, Calendly, Google Drive, Outlook, Microsoft Teams, Sage, FreeAgent, Fathom, Stripe.

### Phase 2.2: Ensure Composio callback URL matches nexley.vercel.app (30 min)

Post-rename (olybuddy → nexley), each Composio auth config may still point to the old callback URL. For each of the 14:
1. platform.composio.dev → Auth Configs
2. Verify callback URL = `https://nexley.vercel.app/api/oauth/<provider>/callback`
3. Fix if stale

### Phase 2.3: Visible-provider QoL polish (half day)

- Add "Recommended for trades" category — surfaces Xero, Fergus, Stripe, GCal, WhatsApp, Gmail first
- Search box autofocus on Add modal open
- Sort connected integrations by `last_synced_at` DESC

**Total Composio wiring effort: ~1 day.**

---

## Part 3 — Timeline + ship order

| Day | Work |
|---|---|
| **1 (AM)** | Kade registers Xero app + pastes creds. Claude smoke-tests Composio on nexley.vercel.app (Part 2). |
| **1 (PM)** | Fix any Composio callback mismatches + ship "Recommended" category UX polish. |
| **2** | Build `lib/integrations/xero.ts` — reads + OAuth verified end-to-end vs Xero sandbox. |
| **3** | Build writes (create invoice, record payment, upload attachment) + UK tax logic. |
| **4** | Expose `/api/agent/xero/*` endpoints + VPS-agent skills. |
| **5** | End-to-end: Julian connects real Xero → books a job via WhatsApp → Nexley drafts real invoice → Julian taps approve. |
| **6 (AM)** | Production checklist: rate-limit guards, error handling, audit log. |

---

## Part 4 — 5 decisions needed before starting

1. **Register Xero dev app now, or wait?** Client ID + Secret need to be in Vercel env before any code runs.
2. **Starter tier ($0, 5 connections) OK?** Enough for Julian + 4 more, then upgrade to Core.
3. **Dashboard-proxies-Xero (Option B) vs VPS-calls-directly (Option A)?** Recommend Option B — cleaner token management.
4. **Ship order: Xero first or Composio audit first?** Recommend Composio audit Monday (1 day quick win) then Xero the rest of week.
5. **UK tax complexity v1:** auto-apply CIS/DRC tax codes, or leave manual for v1 and just draft normal-VAT invoices? Recommend v1 manual, v2 auto after a week of Julian feedback.
