/** Shared UK phone number normalization — used by webhook, SMS, and contacts */

export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  let cleaned = raw.replace(/[\s\-\(\)\.]/g, '')

  // Handle 0044 international prefix
  if (cleaned.startsWith('0044')) {
    cleaned = '+44' + cleaned.slice(4)
  }
  // Handle 07xxx UK mobile format
  else if (cleaned.startsWith('0') && cleaned.length >= 10) {
    cleaned = '+44' + cleaned.slice(1)
  }
  // Handle 44xxx without +
  else if (cleaned.startsWith('44') && !cleaned.startsWith('+') && cleaned.length >= 12) {
    cleaned = '+' + cleaned
  }
  // Ensure + prefix
  else if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned
  }

  // Validate minimum length (UK numbers are 10+ digits after +44)
  if (cleaned.length < 12) return null

  return cleaned
}
