-- Store the WhatsApp username of a contact.
--
-- WHY
--   Migration 037 captured the routing identity (`wa_id`/BSUID) so
--   username-based customers could be reached. But the BSUID is opaque
--   — "CO.1880152882648026" tells an agent nothing about who they're
--   talking to. Meta also sends the human-readable handle in
--   `contacts[].profile.username`, and the webhook was throwing it
--   away: it was only ever used as a fallback when the profile had no
--   display name.
--
--   Persisting it lets the inbox show "@handle" where a phone number
--   would normally go, so a contact with no visible number is still
--   identifiable.
--
-- NOT AN IDENTITY COLUMN
--   Per Meta's docs a user may change their username periodically, and
--   doing so does not change their BSUID. So this is display-only: it
--   is deliberately NOT unique and must never be used for dedupe or
--   routing. `wa_id` remains the stable key.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS username TEXT;

COMMENT ON COLUMN contacts.username IS
  'WhatsApp username from contacts[].profile.username, without the leading @. Display only — users can change it at will, so never dedupe or route on it (use wa_id).';
