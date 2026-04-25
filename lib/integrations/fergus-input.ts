/**
 * Fergus proxy input normaliser.
 *
 * Why this exists: Julian's agent (and any LLM-driven agent that has
 * read the Fergus Partner API docs) naturally produces the Fergus-native
 * shape — `physicalAddress: { address1, addressCity, addressPostcode }`.
 * Our original proxy required snake_case `physical_address.address_line1`
 * and silently dropped anything that didn't match (Zod accepts the body
 * because every field was `.optional()`, but the mapper read undefined).
 * Result: customers created with empty addresses, sites rejected for
 * "address1 required" even when address1 was present.
 *
 * This module exposes permissive Zod fragments + flatten functions:
 *   - `FergusAddressInput` accepts camelCase (Fergus-native), snake_case
 *     (legacy), and mixed-case (Fergus UI) keys; all optional.
 *   - `toFergusAddress(parsed)` flattens to the canonical
 *     `{address1, address2, addressCity, …}` Fergus expects, trims,
 *     and strips empty strings (Fergus rejects empty strings).
 *
 * Same for contacts: `FergusContactInput` + `toFergusContact`.
 *
 * Routes should accept both top-level keys too — `physicalAddress` AND
 * `physical_address` etc. — and pick whichever arrived.
 */

import { z } from 'zod'
import type { FergusAddress, FergusContact } from './fergus'

// ─── Address ──────────────────────────────────────────────────────

export const FergusAddressInput = z.object({
  // Fergus Partner API canonical (recommended)
  address1: z.string().max(200).optional(),
  address2: z.string().max(200).optional(),
  addressSuburb: z.string().max(100).optional(),
  addressCity: z.string().max(100).optional(),
  addressRegion: z.string().max(100).optional(),
  addressPostcode: z.string().max(20).optional(),
  addressCountry: z.string().max(100).optional(),
  // Snake_case (our legacy proxy shape — kept for back-compat)
  address_line1: z.string().max(200).optional(),
  address_line2: z.string().max(200).optional(),
  address_suburb: z.string().max(100).optional(),
  address_city: z.string().max(100).optional(),
  address_region: z.string().max(100).optional(),
  address_postcode: z.string().max(20).optional(),
  address_country: z.string().max(100).optional(),
  // Fergus UI mixed-case ("Address line 1" → addressLine1) — also accepted
  // because that's what someone reading the dashboard would write.
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
})

export type FergusAddressInputType = z.infer<typeof FergusAddressInput>

/**
 * Flatten any of the accepted address shapes to the canonical Fergus shape.
 * Returns `undefined` if nothing usable was provided so the caller can
 * skip sending the field entirely (Fergus rejects empty-object addresses).
 */
export function toFergusAddress(
  a: FergusAddressInputType | undefined | null,
): FergusAddress | undefined {
  if (!a) return undefined
  const candidate: Record<string, string | undefined> = {
    address1: firstNonEmpty(a.address1, a.address_line1, a.addressLine1),
    address2: firstNonEmpty(a.address2, a.address_line2, a.addressLine2),
    addressSuburb: firstNonEmpty(a.addressSuburb, a.address_suburb),
    addressCity: firstNonEmpty(a.addressCity, a.address_city),
    addressRegion: firstNonEmpty(a.addressRegion, a.address_region),
    addressPostcode: firstNonEmpty(a.addressPostcode, a.address_postcode),
    addressCountry: firstNonEmpty(a.addressCountry, a.address_country),
  }
  const stripped: Record<string, string> = {}
  for (const [k, v] of Object.entries(candidate)) {
    if (v !== undefined && v !== '') stripped[k] = v
  }
  return Object.keys(stripped).length === 0 ? undefined : (stripped as FergusAddress)
}

// ─── Contact ──────────────────────────────────────────────────────

export const FergusContactInput = z.object({
  // Fergus-native
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  // Snake_case (legacy)
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  // Email-light: don't enforce format here so a typo doesn't cascade
  // into a 400 that hides the real bug. Fergus will reject if invalid.
  email: z.string().max(200).optional(),
  mobile: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
})

export type FergusContactInputType = z.infer<typeof FergusContactInput>

export function toFergusContact(
  c: FergusContactInputType | undefined | null,
): FergusContact | undefined {
  if (!c) return undefined
  const candidate: Record<string, string | undefined> = {
    firstName: firstNonEmpty(c.firstName, c.first_name),
    lastName: firstNonEmpty(c.lastName, c.last_name),
    email: emptyToUndef(c.email),
    mobile: emptyToUndef(c.mobile),
    phone: emptyToUndef(c.phone),
  }
  const stripped: Record<string, string> = {}
  for (const [k, v] of Object.entries(candidate)) {
    if (v !== undefined && v !== '') stripped[k] = v
  }
  return Object.keys(stripped).length === 0 ? undefined : (stripped as FergusContact)
}

// ─── Helpers ──────────────────────────────────────────────────────

function firstNonEmpty(...xs: (string | undefined | null)[]): string | undefined {
  for (const x of xs) {
    if (typeof x === 'string' && x.trim() !== '') return x.trim()
  }
  return undefined
}

function emptyToUndef(x: string | undefined | null): string | undefined {
  if (typeof x !== 'string') return undefined
  const t = x.trim()
  return t === '' ? undefined : t
}
