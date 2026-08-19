import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * Generates one pharmacy's EMR connection key OUTSIDE the running app, and prints
 * both halves of it: the plaintext to paste into the clinic's "Connect a pharmacy"
 * form, and the encrypted columns to store against the pharmacy row.
 *
 * <p>This is the no-deploy path. The supported way is the pharmacy's own
 * Integrations → Clinic / EMR screen, which does exactly this through the API and
 * never puts the key in a shell history or a terminal buffer. Use this only when
 * that screen is not deployed yet.
 *
 * <p>Mirrors {@code EmrSecretCipher} exactly — AES-256-GCM, 12-byte nonce, auth tag
 * stored separately, every part base64. A round-trip check runs before anything is
 * printed, so a wrong key fails here rather than as an unexplained 401 in production.
 *
 * Usage:
 *   java scripts/MakeEmrKey.java /path/to/.env.prod
 */
public class MakeEmrKey {

    private static final String KEY_VAR = "EMR_CONNECTION_ENCRYPTION_KEY=";

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: java scripts/MakeEmrKey.java <path-to-env-file>");
            System.exit(2);
        }

        String rawKey = null;
        for (String line : Files.readAllLines(Paths.get(args[0]))) {
            if (line.startsWith(KEY_VAR)) {
                rawKey = line.substring(KEY_VAR.length()).trim().replaceAll("^['\"]|['\"]$", "");
            }
        }
        if (rawKey == null || rawKey.isBlank()) {
            System.err.println(KEY_VAR + " not found in " + args[0]);
            System.exit(1);
        }

        byte[] keyBytes = Pattern.matches("^[a-fA-F0-9]{64}$", rawKey)
                ? hexToBytes(rawKey)
                : Base64.getDecoder().decode(rawKey);
        if (keyBytes.length != 32) {
            System.err.println("encryption key must encode exactly 32 bytes");
            System.exit(1);
        }
        SecretKeySpec key = new SecretKeySpec(keyBytes, "AES");
        SecureRandom rng = new SecureRandom();

        byte[] raw = new byte[32];
        rng.nextBytes(raw);
        String plain = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

        byte[] iv = new byte[12];
        rng.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] combined = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = Arrays.copyOfRange(combined, 0, combined.length - 16);
        byte[] tag = Arrays.copyOfRange(combined, combined.length - 16, combined.length);

        Cipher back = Cipher.getInstance("AES/GCM/NoPadding");
        back.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        if (!plain.equals(new String(back.doFinal(combined), StandardCharsets.UTF_8))) {
            System.err.println("round-trip failed — nothing written, nothing to paste");
            System.exit(1);
        }

        Base64.Encoder b64 = Base64.getEncoder();
        System.out.println();
        System.out.println("Shared secret (paste into the clinic's Connect a pharmacy form):");
        System.out.println("  " + plain);
        System.out.println();
        System.out.println("SQL for the pharmacy database (replace the id prefix if it matches more than one row):");
        System.out.println();
        System.out.println("  UPDATE pharmacies SET");
        System.out.println("      \"emrSecretCiphertext\" = '" + b64.encodeToString(ciphertext) + "',");
        System.out.println("      \"emrSecretIv\"         = '" + b64.encodeToString(iv) + "',");
        System.out.println("      \"emrSecretTag\"        = '" + b64.encodeToString(tag) + "'");
        System.out.println("  WHERE id LIKE 'cmszyiz1%'");
        System.out.println("  RETURNING id, name;   -- the returned id is the Pharmacy ID for the clinic's form");
        System.out.println();
    }

    private static byte[] hexToBytes(String hex) {
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
