-- Migration: Add privacy consent tracking to profiles
-- Task 6.03 — Privacy Consent Modal
-- Tracks when the user accepted the privacy/processing consent
-- and which version of the consent text they accepted.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS privacy_consent_version TEXT NULL;

COMMENT ON COLUMN profiles.privacy_consent_at IS 'Timestamp when user accepted the privacy consent modal. NULL = not yet accepted.';
COMMENT ON COLUMN profiles.privacy_consent_version IS 'Version identifier of the consent text accepted (e.g. v1). Allows re-prompting if terms change.';
