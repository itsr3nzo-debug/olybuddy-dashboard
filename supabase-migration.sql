-- Sprint 2: AI Employee Data Model Migration
-- Run this in Supabase Dashboard > SQL Editor

-- New columns on agent_config for AI Employee identity
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS agent_name TEXT DEFAULT 'Nexley';
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS agent_status TEXT DEFAULT 'online';
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ;
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'friendly';
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]';
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS escalation_rules JSONB DEFAULT '[]';
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';

-- Backfill last_call_at from existing call data
UPDATE agent_config ac SET last_call_at = (
  SELECT MAX(started_at) FROM call_logs cl WHERE cl.client_id = ac.client_id
) WHERE last_call_at IS NULL;

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_agent_config_status ON agent_config(client_id, agent_status);

-- Add CHECK constraints (run separately if needed)
-- ALTER TABLE agent_config ADD CONSTRAINT chk_agent_status CHECK (agent_status IN ('online', 'offline', 'in_call', 'idle'));
-- ALTER TABLE agent_config ADD CONSTRAINT chk_tone CHECK (tone IN ('formal', 'friendly', 'casual'));
