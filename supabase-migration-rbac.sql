-- RBAC Migration: Add role to app_metadata for all auth users
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/awmsstlhbxsxlwydczdr/sql/new

-- Step 1: Backfill all existing users as 'owner' (safe default — all current users are paying clients)
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "owner"}'::jsonb
WHERE raw_app_meta_data->>'role' IS NULL;

-- Step 2: Set super_admin for Nexley AI team (cross-tenant access)
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  raw_app_meta_data || '{"role": "super_admin"}'::jsonb,
  '{client_id}',
  'null'::jsonb
)
WHERE email = 'lorenzobandawe@gmail.com';

-- Verify
SELECT email, raw_app_meta_data->>'role' as role, raw_app_meta_data->>'client_id' as client_id
FROM auth.users
ORDER BY created_at;
