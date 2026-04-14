-- Agent Heartbeats: VPS health monitoring coordination layer
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug text NOT NULL,
  vps_hostname text NOT NULL,
  timestamp timestamptz DEFAULT now(),
  whatsapp_connected boolean DEFAULT true,
  memory_mb integer DEFAULT 0,
  disk_pct integer DEFAULT 0,
  status text DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'critical')),
  created_at timestamptz DEFAULT now()
);

-- Index for fast staleness queries
CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_time ON agent_heartbeats (agent_slug, timestamp DESC);

-- Auto-delete old heartbeats (keep 7 days)
-- Run this as a Supabase pg_cron job or manual cleanup
-- DELETE FROM agent_heartbeats WHERE created_at < now() - interval '7 days';
