'use client'

import { createContext, useContext } from 'react'
import type { UserSession, UserRole, Permission } from './rbac'

const RoleContext = createContext<UserSession | null>(null)

export function RoleProvider({ session, children }: { session: UserSession; children: React.ReactNode }) {
  return <RoleContext.Provider value={session}>{children}</RoleContext.Provider>
}

export function useSession(): UserSession {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useSession must be used within RoleProvider')
  return ctx
}

export function useRole(): UserRole {
  return useSession().role
}

export function useHasPermission(permission: Permission): boolean {
  const { role } = useSession()
  const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    super_admin: ['edit_settings', 'edit_billing', 'edit_integrations', 'invite_members', 'view_money', 'view_agent_logs', 'view_all_clients', 'provision_clients'],
    owner: ['edit_settings', 'edit_billing', 'edit_integrations', 'invite_members', 'view_money', 'view_agent_logs'],
    member: [],
  }
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}
