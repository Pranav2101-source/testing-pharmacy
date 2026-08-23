-- Fixes ClinicPairingService#findByPairingCode's O(n) full-table AES-GCM decrypt scan — see
-- that method's own comment, which already names this exact fix as the thing to do "if the
-- set ever grows enough to matter."
--
-- WHY THE CIPHERTEXT ITSELF CAN'T BE INDEXED
-- A pairing code IS a pharmacy's own emrSecretCiphertext, decrypted. AES-GCM uses a random
-- nonce per encryption, so encrypting the SAME plaintext twice produces two DIFFERENT
-- ciphertexts — there is no equality on the encrypted column to index. That is exactly the
-- property that makes the at-rest encryption worth having, and it is also why finding a code
-- has always meant decrypting every candidate to compare plaintexts.
--
-- THE FIX
-- A separate, deterministic SHA-256 hash of the plaintext key (ApiSecretHasher — the same
-- "256 bits of SecureRandom needs no KDF" reasoning this codebase already applies to API
-- secrets, and already trusted as a sole authentication decision in
-- EmrApiKeyAuthenticationFilter), written once, at the only moment the plaintext exists
-- server-side: EmrConnectionService#generateKey (and TenantService#rotateEmrSecret, the
-- platform-admin equivalent). Pairing then looks up by hash first — an ordinary indexed
-- equality lookup — and only falls back to the old decrypt scan for pharmacies whose key
-- predates this column, a set that only shrinks as keys are naturally rotated.
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "emrSecretLookupHash" TEXT;

CREATE INDEX IF NOT EXISTS "pharmacies_emr_secret_lookup_hash_idx"
  ON "pharmacies" ("emrSecretLookupHash")
  WHERE "emrSecretLookupHash" IS NOT NULL;
