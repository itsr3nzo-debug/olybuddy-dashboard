"use client";

import React, { createContext, useContext } from 'react';

export interface ClientCtx {
  clientId: string;
  clientName: string;
  userEmail: string;
  /** Owner's display name (first name), if available */
  ownerName?: string;
}

const Ctx = createContext<ClientCtx>({
  clientId: '',
  clientName: 'My Business',
  userEmail: '',
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
