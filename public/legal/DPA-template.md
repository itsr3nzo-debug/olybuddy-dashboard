# Data Processing Agreement — Nexley AI

**Between:** [Client Business Name] ("Controller")
**And:** Nexley AI Ltd ("Processor", "we", "us") — company number [tbd], registered at [address].

**Effective date:** date of signature.

This DPA applies to any Processing carried out by Nexley AI on behalf of the
Controller under the Main Agreement (subscription to the Nexley AI Employee
service). It is intended to satisfy Article 28 of the UK GDPR and the Data
Protection Act 2018.

---

## 1. Definitions

Terms have the meaning given in UK GDPR (retained EU Regulation 2016/679).
"Personal Data", "Processing", "Controller", "Processor", "Sub-processor"
and "Supervisory Authority" have those statutory meanings.

## 2. Subject matter, nature, purpose, duration

| Item | Description |
|---|---|
| Subject matter | Operation of an AI Employee service that reads/writes the Controller's business communications, calendars, CRM, accounting, and file-storage systems on the Controller's instruction. |
| Nature of processing | Collection, storage, transmission, retrieval, logging, analysis (LLM inference), deletion. |
| Purpose | Fulfilment of the Main Agreement — providing automated response, booking, follow-up, invoicing, reporting services to the Controller and its end-customers. |
| Duration | Term of the Main Agreement. Data returned or deleted within 30 days of termination. |
| Categories of data subject | The Controller's end-customers; the Controller's staff; business contacts. |
| Categories of personal data | Names, phone numbers, email addresses, postal addresses, service-request details, message content, call transcripts, appointment details, invoice data. We do NOT knowingly process: health data, biometric data, religious/political data, criminal offence data, or children's data. |

## 3. Obligations of the Processor

3.1 Process Personal Data only on documented instructions from the Controller, including with regard to transfers outside the UK.

3.2 Ensure personnel with access are bound by confidentiality.

3.3 Implement appropriate technical and organisational measures (Annex A).

3.4 Assist the Controller in responding to data subject rights requests (access, rectification, erasure, portability, restriction, objection) within 14 days of receiving a request.

3.5 Notify the Controller without undue delay (and within 48 hours) after becoming aware of a Personal Data Breach.

3.6 Make available all information necessary to demonstrate compliance; allow and contribute to audits by the Controller or an independent auditor mandated by the Controller.

3.7 Delete or return all Personal Data to the Controller within 30 days of termination, unless UK law requires retention.

## 4. Sub-processors

The Controller grants general authorisation for the Processor to engage the sub-processors listed in Annex B. The Processor will inform the Controller of any intended additions or replacements with at least 14 days' notice, giving the Controller the opportunity to object.

All sub-processors are bound by contract to data-protection obligations at least as strict as those in this DPA.

## 5. International transfers

Personal Data is processed within the UK and EEA. Where a sub-processor transfers data outside the UK/EEA (e.g. Anthropic for model inference — US-based), that transfer is protected by Standard Contractual Clauses and the UK International Data Transfer Addendum (IDTA).

## 6. Security measures — Annex A

### Organisational
- Access to production systems restricted to vetted personnel on a need-to-know basis.
- All personnel sign confidentiality agreements on onboarding.
- Background-check for personnel with production database access.
- Incident response runbook tested quarterly.

### Technical
- Encryption at rest: AES-256 (Supabase, Composio, Vercel, Hetzner).
- Encryption in transit: TLS 1.3 for all service-to-service traffic.
- OAuth tokens never stored in our database; held by Composio (SOC 2 Type 2).
- Per-client data isolation via Postgres Row-Level Security + scoped JWTs. No shared service-role credentials on client-facing machines.
- Dashboard authentication: passwordless magic links.
- Infrastructure monitoring with 1-minute heartbeat; automated alerting on authentication failures, service crashes, or anomalous access.
- Zero data used to train AI models. Anthropic contractually does not train on API traffic.
- Daily backups with 30-day retention; quarterly restoration test.
- Dependency vulnerability scanning (Dependabot/Snyk) on every commit.

## 7. Sub-processors — Annex B

| Sub-processor | Purpose | Location | Certifications |
|---|---|---|---|
| Supabase | Database, auth | EU (Frankfurt) | SOC 2 Type 2, HIPAA |
| Composio | OAuth token management, integration gateway | US | SOC 2 Type 2 |
| Vercel | Dashboard hosting | Global edge + EU primary | SOC 2 Type 2, ISO 27001 |
| Hetzner | VPS hosting for each client agent | Germany | ISO 27001 |
| Anthropic | AI model inference | US (SCCs + IDTA in place) | SOC 2 Type 2 |
| Stripe | Billing | UK/US | PCI DSS Level 1 |

## 8. Governing law and jurisdiction

This DPA is governed by the laws of England and Wales. Disputes subject to the exclusive jurisdiction of the courts of England and Wales.

---

**Signed for Nexley AI Ltd:**
Name:
Title:
Date:

**Signed for Controller:**
Name:
Title:
Date:
