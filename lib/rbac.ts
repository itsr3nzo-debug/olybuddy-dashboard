/** Role-Based Access Control — types, permissions, and helpers */

import type { User } from '@supabase/supabase-js'

// --- Types ---

export type UserRole = 'super_admin' | 'owner' | 'member'

export interface UserSession {
  id: string
  email: string
  role: UserRole
  clientId: string | null
}

export type Permission =
  | 'edit_settings'
  | 'edit_billing'
  | 'edit_integrations'
  | 'invite_members'
  | 'view_money'
  | 'view_agent_logs'
  | 'view_all_clients'
  | 'provision_clients'

// --- Permission Map ---

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'edit_settings', 'edit_billing', 'edit_integrations', 'invite_members',
    'view_money', 'view_agent_logs', 'view_all_clients', 'provision_clients',
  ],
  owner: [
    'edit_settings', 'edit_billing', 'edit_integrations', 'invite_members',
    'view_money', 'view_agent_logs',
  ],
  member: [],
}

// Pages that members cannot access
export const MEMBER_BLOCKED_PAGES = ['/settings', '/integrations']

// Pages only super_admin can access
export const ADMIN_ONLY_PAGES = ['/admin']

// --- Functions ---

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function canAccessPage(role: UserRole, pathname: string): boolean {
  if (role === 'super_admin') return true
  if (role === 'owner') return !ADMIN_ONLY_PAGES.some(p => pathname.startsWith(p))
  // member — block restricted pages
  return !MEMBER_BLOCKED_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'))
    && !ADMIN_ONLY_PAGES.some(p => pathname.startsWith(p))
}

export function getUserSession(user: User): UserSession {
  const meta = user.app_metadata ?? {}
  return {
    id: user.id,
    email: user.email ?? '',
    role: (meta.role as UserRole) ?? 'member', // fails closed — unknown users get least privilege
    clientId: meta.client_id ?? null,
  }
}
