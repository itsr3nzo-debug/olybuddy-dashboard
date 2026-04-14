/** Server-side page guards for RBAC */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserSession, canAccessPage, hasPermission, type UserSession, type UserRole, type Permission } from './rbac'

/**
 * Check if the current user can access a page. Redirects to /dashboard if not.
 * Use at the top of restricted server components.
 */
export async function requireAccess(pathname: string): Promise<UserSession> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const session = getUserSession(user)

  if (!canAccessPage(session.role, pathname)) {
    redirect('/dashboard')
  }

  return session
}

/**
 * Check if the current user has one of the specified roles.
 * Redirects to /dashboard if not.
 */
export async function requireRole(...roles: UserRole[]): Promise<UserSession> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const session = getUserSession(user)

  if (!roles.includes(session.role)) {
    redirect('/dashboard')
  }

  return session
}

/**
 * Check if the current user has a specific permission.
 * Redirects to /dashboard if not.
 */
export async function requirePermission(permission: Permission): Promise<UserSession> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const session = getUserSession(user)

  if (!hasPermission(session.role, permission)) {
    redirect('/dashboard')
  }

  return session
}
