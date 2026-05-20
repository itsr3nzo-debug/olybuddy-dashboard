-- supabase-migration-terms-consent.sql
-- ----------------------------------------------------------------
-- T&Cs consent record. Captures the legally-significant moment the
-- customer ticked the Terms checkbox during signup (Step 5 of the
-- wizard).
--
-- Why these three columns:
--   terms_agreed_at   — ISO timestamp recorded by the client the moment
--                       the checkbox was ticked. Required for valid
--                       consent under UK Consumer Contracts Regs 2013.
--   terms_version     — Pins consent to a specific document version
--                       (e.g. "v2-2026-05-19"). Future T&Cs amendments
--                       can update existing customers' version only with
--                       a fresh notice flow; this column preserves what
--                       they originally agreed to for dispute purposes.
--   terms_agreed_ip   — Request IP at the time of consent. Extra evidence
--                       beyond the timestamp; complements the row's
--                       audit_log entries (Stripe receipt, email
--                       verification, etc.) as the consent paper-trail.
--
-- Idempotent — safe to re-run.
-- ----------------------------------------------------------------

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS terms_agreed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version   TEXT,
  ADD COLUMN IF NOT EXISTS terms_agreed_ip TEXT;

COMMENT ON COLUMN clients.terms_agreed_at IS
  'When the customer ticked the T&Cs checkbox during signup. Legal proof of consent (Consumer Contracts Regs 2013). Null for accounts created before the consent flow shipped.';
COMMENT ON COLUMN clients.terms_version IS
  'Specific T&Cs version the customer agreed to (e.g. "v2-2026-05-19"). Future amendments do not retroactively bind earlier customers.';
COMMENT ON COLUMN clients.terms_agreed_ip IS
  'Request IP at the time of consent — additional evidence alongside terms_agreed_at.';

-- Backfill historic customers as "agreed via legacy flow" so admin queries
-- on terms-coverage don't show every pre-feature customer as missing
-- consent. Operationally these customers DID see + click through earlier
-- T&Cs versions, just without the dedicated checkbox.
UPDATE clients
SET terms_version = 'legacy-pre-2026-05-20'
WHERE terms_version IS NULL
  AND created_at < '2026-05-20T00:00:00Z'
  AND terms_agreed_at IS NULL;
