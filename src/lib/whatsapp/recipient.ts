import {
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from './phone-utils'

/**
 * How a contact is addressed when sending through Meta.
 *
 * WHY THIS EXISTS
 *   "Which value do we send to?" was answered independently in three
 *   places: the inbox send path, the automations engine, and the flows
 *   engine. When WhatsApp's username rollout made `contacts.phone`
 *   optional (a BSUID-only contact has no number), only the inbox path
 *   was updated. The other two kept bailing on `!contact.phone`, so
 *   automations and flows silently did nothing for username senders —
 *   the trigger fired, the send step threw, and nothing reached the
 *   customer.
 *
 *   Centralising it means the next identity change lands everywhere at
 *   once.
 */

export interface ContactIdentityRow {
  phone?: string | null
  /** Business-Scoped User ID. Set for contacts created from a
   *  username-based sender; null on legacy and manually-added rows. */
  wa_id?: string | null
}

export interface ResolvedRecipient {
  /**
   * Value handed to the meta-api send helpers. They decide whether it
   * travels as `to` (phone) or `recipient` (BSUID) — see
   * `recipientField` in meta-api.ts.
   */
  value: string
  /** True when `value` is a dialable phone number rather than a BSUID. */
  isPhone: boolean
  /**
   * Values to attempt, in order. Phone numbers get trunk-prefix
   * variants because some numbers are registered with a leading 0 and
   * some without. A BSUID is opaque — permuting its digits would
   * address a different person — so it gets exactly one attempt.
   */
  variants: string[]
}

/**
 * Resolve how to reach a contact, preferring a dialable phone number.
 *
 * Returns null when the contact has neither a usable number nor a
 * BSUID — that contact is genuinely unreachable and the caller should
 * surface it rather than send into the void.
 */
export function resolveContactRecipient(
  contact: ContactIdentityRow | null | undefined,
): ResolvedRecipient | null {
  const sanitized = sanitizePhoneForMeta(contact?.phone ?? '')
  if (isValidE164(sanitized)) {
    return {
      value: sanitized,
      isPhone: true,
      variants: phoneVariants(sanitized),
    }
  }

  const waId = String(contact?.wa_id ?? '').trim()
  if (waId) {
    return { value: waId, isPhone: false, variants: [waId] }
  }

  return null
}
