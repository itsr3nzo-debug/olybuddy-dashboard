-- supabase-migration-trial-cadence-3day.sql
-- ----------------------------------------------------------------
-- Reshape trial_sequence to match the 3-day trial cadence.
--
-- Old (5-day trial) → New (3-day trial)
--   day1_sent_at    → day1_sent_at   (Day 1 welcome — unchanged)
--   day3_sent_at    → day3_sent_at   (RE-PURPOSED — was "Gmail nudge", now "Day 3 charged today")
--   day4_sent_at    → day2_sent_at   (renamed — was "Day 4 tomorrow", now "Day 2 tomorrow")
--   day5_sent_at    → day3_sent_at   (renamed — was "Day 5 today",     now "Day 3 today"; backfilled where day3 was empty)
--   winback_sent_at → winback_sent_at (unchanged)
--
-- We backfill instead of drop-and-rename so in-flight 5-day-trial customers
-- (already in the email cycle when the cron switches) don't get a duplicate
-- "tomorrow"/"today" email.
--
-- Idempotent — safe to re-run.
-- ----------------------------------------------------------------

-- 1. Add the new Day 2 marker column.
ALTER TABLE trial_sequence
  ADD COLUMN IF NOT EXISTS day2_sent_at TIMESTAMPTZ;

-- 2. Backfill day2 from the old day4 column (the OLD "Day 4 tomorrow" timing
--    is the same moment as the NEW "Day 2 tomorrow" — 1 day before charge).
UPDATE trial_sequence
SET day2_sent_at = day4_sent_at
WHERE day4_sent_at IS NOT NULL
  AND day2_sent_at IS NULL;

-- 3. Re-purpose day3 from "Gmail nudge" to "Day 3 today charged".
--    DA-C4 fix: rows where the OLD day3_sent_at was already populated
--    (because the Gmail nudge had fired) would be skipped by a NULL-only
--    backfill — leaving day3_sent_at meaning "Gmail nudge sent" instead
--    of "today-charged sent", which causes the new cron at pickStage() to
--    think Day 3 already fired and skip the "charged today" notice. So:
--    (a) preserve the legacy Gmail-nudge timestamps in a dedicated column
--        for audit purposes, then (b) clear day3 + repoint to day5.
ALTER TABLE trial_sequence
  ADD COLUMN IF NOT EXISTS day3_legacy_gmail_nudge_at TIMESTAMPTZ;
UPDATE trial_sequence
SET day3_legacy_gmail_nudge_at = day3_sent_at
WHERE day3_sent_at IS NOT NULL
  AND day3_legacy_gmail_nudge_at IS NULL;
-- Now we can safely overwrite day3_sent_at with day5_sent_at across the board:
--   * rows with day5 populated → those become the new Day-3 marker
--   * rows without day5 (never got the OLD "today" email) → day3 becomes NULL,
--     which is correct since they never got the NEW "today" email either.
UPDATE trial_sequence
SET day3_sent_at = day5_sent_at
WHERE day5_sent_at IS NOT NULL OR day3_legacy_gmail_nudge_at IS NOT NULL;

-- 4. DA-C1 fix: in-flight customers who signed up BEFORE this migration
--    are on a Stripe-side 5-day trial. The new cron's pickStage() would
--    fire Day 2 ("charged tomorrow") on their daysSince=2 — wrong, their
--    Stripe charge isn't for another 3 days. Mark them as "all emails
--    sent" so the new cron skips them; the webhook/billing page still
--    drives correct messaging from clients.trial_ends_at.
UPDATE trial_sequence ts
SET day2_sent_at = COALESCE(ts.day2_sent_at, NOW()),
    day3_sent_at = COALESCE(ts.day3_sent_at, NOW())
WHERE ts.upgraded_at IS NULL
  AND ts.signed_up_at < '2026-05-20T00:00:00Z';

-- 5. Drop the now-unused columns. The cron no longer SELECTs or UPDATEs them.
ALTER TABLE trial_sequence
  DROP COLUMN IF EXISTS day4_sent_at,
  DROP COLUMN IF EXISTS day5_sent_at;

-- 5. Document the new semantics on the surviving columns.
COMMENT ON COLUMN trial_sequence.day1_sent_at IS
  'Day 1 of trial — welcome email + first-step nudge.';
COMMENT ON COLUMN trial_sequence.day2_sent_at IS
  'Day 2 of trial — "card will be charged tomorrow" reminder (3-day cadence, added 2026-05-20).';
COMMENT ON COLUMN trial_sequence.day3_sent_at IS
  'Day 3 of trial — "card charged today" final notice. Semantics changed 2026-05-20: was previously "Gmail integration nudge" under the 5-day cadence.';
COMMENT ON COLUMN trial_sequence.winback_sent_at IS
  'Post-trial winback — fires 10+ days after signup if the customer never upgraded.';
