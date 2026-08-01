-- Contact identity by WhatsApp ID, not just by phone number.
--
-- WHY
--   WhatsApp's username rollout lets a customer message a business
--   without exposing a phone number. Their routing identity arrives in
--   the webhook as `contacts[].wa_id`, but processMessage() ran it
--   through normalizePhone() — digits-only — which reduces a username
--   to ''. Three failures followed from that single lossy step:
--
--     1. The contact was stored with phone = '' (NOT NULL, so the
--        empty string passed), leaving no way to reply. Agents saw
--        "Contact phone number not found" on every send.
--     2. findExistingContact() bails on an empty phone, so dedupe
--        never matched and EVERY inbound message minted another
--        contact + conversation — the "phantom contacts".
--     3. The identity was never persisted anywhere, so it could not
--        be recovered after the fact.
--
--   Storing `wa_id` verbatim fixes all three: sends have a recipient
--   (Meta accepts a WhatsApp ID in `to`), dedupe has a stable key, and
--   the identity survives.
--
-- NOTE ON EXISTING PHANTOM ROWS
--   Contacts already created with phone = '' cannot be repaired here —
--   their identity was discarded before it ever reached the database.
--   They are left untouched (wa_id stays NULL). Once this ships, the
--   next message from those customers is captured correctly.

-- 1) The identity column. Nullable: legacy rows have no wa_id, and a
--    contact created by hand (manual add / CSV import) never will.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_id TEXT;

COMMENT ON COLUMN contacts.wa_id IS
  'WhatsApp routing identity from the webhook (contacts[].wa_id), stored verbatim. Historically equal to the digits-only phone; may be a non-numeric identifier for username-based senders. Preferred over phone when sending.';

-- 2) Backfill. For every contact that already has a usable number the
--    wa_id has always BEEN that number in digits-only form, so this is
--    a derivation, not a guess. Phantom rows (phone_normalized = '')
--    are skipped and keep wa_id NULL.
UPDATE contacts
   SET wa_id = phone_normalized
 WHERE wa_id IS NULL
   AND phone_normalized <> '';

-- 3) One contact per (account, wa_id). Partial so the rows that
--    legitimately have no wa_id — phantoms, manual adds, imports —
--    don't collide with one another.
--
--    Safe against duplicates from step 2: migration 022 already
--    enforces UNIQUE (account_id, phone_normalized) WHERE
--    phone_normalized <> '', and the backfill copies exactly that
--    column, so the values inserted here are unique by construction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_id
  ON contacts (account_id, wa_id)
  WHERE wa_id IS NOT NULL AND wa_id <> '';
