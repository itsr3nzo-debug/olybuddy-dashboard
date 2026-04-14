'use client'

import { useHasPermission } from '@/lib/role-context'
import type { Permission } from '@/lib/rbac'

interface PermissionGateProps {
  permission: Permission
  children: React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Renders children only if the current user has the specified permission.
 * Use for hiding edit buttons, forms, or sections from restricted roles.
 */
export default function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const allowed = useHasPermission(permission)
  return allowed ? <>{children}</> : <>{fallback}</>
}
