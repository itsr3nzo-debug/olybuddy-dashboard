"use client";

import React, { createContext, useContext } from 'react';

export interface ClientCtx {
  clientId: string;
  clientName: string;
  userEmail: string;
  /** Owner's display name (first name), if available */
  ownerName?: string;
  /** True when a super_admin is viewing the chat — used to enable the
   * client-switcher chevron on the workspace name in the sidebar. */
  isAdminView?: boolean;
}

const Ctx = createContext<ClientCtx>({
  clientId: '',
  clientName: 'My Business',
  userEmail: '',
  isAdminView: false,
});

export function ClientContextProvider({
  value,
  children,
}: {
  value: ClientCtx;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClient(): ClientCtx {
  return useContext(Ctx);
}
