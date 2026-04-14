-- Onboarding Migration: Add columns for self-service signup + VPS deployment tracking
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/awmsstlhbxsxlwydczdr/sql/new

-- Client details from signup form
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS services_text TEXT;

-- Stripe subscription tracking
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- VPS deployment lifecycle
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vps_status TEXT DEFAULT 'pending';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vps_ip TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vps_server_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clients' AND table_schema = 'public'
ORDER BY ordinal_position;
