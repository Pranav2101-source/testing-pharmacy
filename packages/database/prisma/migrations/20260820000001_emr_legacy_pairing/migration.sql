-- Automatic clinic pairing, and the credentials it establishes.
--
-- WHY THIS EXISTS
-- 20260819000004 let a pharmacy type its clinic's address in by hand and generate a key
-- the pharmacist then read across to the clinic. That works, but it is a two-sided manual
-- handshake: someone has to copy a 43-character secret between two screens without
-- transposing it, and the pharmacy still has to be told the clinic's callback path.
--
-- Pairing collapses that into one exchange. The clinic presents the code the pharmacist
-- generated and, in the same call, hands over where to reach it and the secret to sign
-- callbacks with. The pharmacy answers with a credential scoped to that clinic. Nothing is
-- retyped, and neither side has to be told anything the other already knows.
--
-- WHY A SECOND CREDENTIAL SCHEME
-- The clinic's existing client authenticates with an API key/secret pair, not the
-- per-request HMAC this pharmacy prefers. Rather than make the other product change first
-- and block on a deploy nobody here controls, the pharmacy speaks both. The HMAC surface at
-- /api/v1/integrations/emr is unchanged and remains the preferred contract; these columns
-- serve the compatibility surface at /api/v1/integration.
--
-- Additive and idempotent throughout. Every column is nullable, nothing is backfilled, and
-- no existing column is touched — a pharmacy that never pairs is byte-for-byte unaffected,
-- and the migration is safe to re-run if a hand-application stops half way.

-- ─── Who we are paired with ──────────────────────────────────────────────────────────────

-- The clinic's own id for itself, as it presented at pairing. Stored because every
-- subsequent request from that clinic identifies its tenant this way, and because it is what
-- distinguishes two clinics that happen to share a display name.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrClinicExternalId" TEXT;

-- Our id for the link, returned to the clinic at pairing and quoted back by it in support
-- conversations. Deliberately NOT the pharmacy id: that leaks a tenant identifier into
-- another product's database, and it cannot be rotated if the link is torn down and rebuilt.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrClinicLinkId" TEXT;

ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrPairedAt" TIMESTAMP(3);

-- ─── The credential the clinic authenticates with ────────────────────────────────────────

-- The key half is an IDENTIFIER, not a secret: it arrives in a header on every request and
-- is what we look the pharmacy up by, so it is stored in the clear and indexed.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrApiKey" TEXT;

-- The secret half is stored as a SHA-256 hash and never in the clear — it is shown to the
-- clinic once, at pairing, and cannot be recovered afterwards. Re-pair rather than trying.
--
-- SHA-256 rather than bcrypt/argon2 deliberately. A slow KDF exists to make guessing a
-- low-entropy human password expensive; this is 256 bits from a CSPRNG, where guessing is
-- not a threat model that arithmetic can reach. A slow hash here would only add latency to
-- every single machine request, on the hot path, for no security gain.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrApiSecretHash" TEXT;

-- Lookup index for the inbound auth path: one indexed equality per request, and partial
-- because the overwhelming majority of pharmacies have never paired and hold NULL here.
CREATE UNIQUE INDEX IF NOT EXISTS "pharmacies_emrApiKey_key"
    ON "pharmacies" ("emrApiKey")
    WHERE "emrApiKey" IS NOT NULL;

-- ─── The secret WE sign callbacks with ───────────────────────────────────────────────────

-- Handed to us by the clinic at pairing: its webhook secret, which our dispense callback
-- signs with so the clinic can verify the call came from this pharmacy.
--
-- Encrypted at rest with the same AES-256-GCM key and column shape as "emrSecret*" (see
-- EmrSecretCipher). It is somebody else's credential, which is a reason for more care than
-- our own, not less.
--
-- Its PRESENCE is also the dialect discriminator: a pharmacy holding a clinic webhook secret
-- was paired through the compatibility route and its callbacks are signed the clinic's way.
-- That is a real dependency rather than a flag to keep in sync — the secret is the thing you
-- sign with, so having it and using it cannot drift apart.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrWebhookSecretCiphertext" TEXT;
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrWebhookSecretIv"         TEXT;
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrWebhookSecretTag"        TEXT;
