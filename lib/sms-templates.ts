/** SMS message templates for automated follow-ups */

export function followUpAfterCall(callerName: string, businessName: string): string {
  const name = callerName || 'there'
  return `Hi ${name}, thanks for calling ${businessName}! We've noted your enquiry and someone will be in touch shortly. If you need anything urgent, call us back anytime.`
}

export function missedCallFollowUp(callerName: string, businessName: string): string {
  const name = callerName || 'there'
  return `Hi ${name}, sorry we missed your call to ${businessName}. We'll get back to you as soon as possible. In the meantime, feel free to call again — our AI receptionist is available 24/7.`
}

export function consultationBooked(callerName: string, businessName: string): string {
  const name = callerName || 'there'
  return `Hi ${name}, great news! Your free consultation with ${businessName} has been noted. We'll confirm the details shortly. Looking forward to helping you!`
}
