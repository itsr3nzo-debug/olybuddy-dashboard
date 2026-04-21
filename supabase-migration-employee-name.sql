-- Migration: Ensure agent_config.agent_name is present + defaulted
-- Date: 2026-04-18
-- Reason: agent_name was added in Sprint 2 but some early rows may have NULL,
-- and the signup flow now requires a client-chosen display name.

-- 1) Make sure the column exists (no-op if it does).
ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- 2) Set a sensible default for future inserts.
ALTER TABLE agent_config
  ALTER COLUMN agent_name SET DEFAULT 'Nexley';

-- 3) Backfill any existing NULLs → 'Nexley' (brand default).
UPDATE agent_config
SET agent_name = 'Nexley'
WHERE agent_name IS NULL OR trim(agent_name) = '';

-- 4) Hard-require it going forward so a broken row can't silently default to
--    an empty string the agent would interpret as "use placeholder".
ALTER TABLE agent_config
  ALTER COLUMN agent_name SET NOT NULL;

-- 5) Cap the length at 30 chars to match the UI validator.
ALTER TABLE agent_config
  DROP CONSTRAINT IF EXISTS agent_name_length_check;

ALTER TABLE agent_config
  ADD CONSTRAINT agent_name_length_check
    CHECK (char_length(agent_name) BETWEEN 1 AND 30);
