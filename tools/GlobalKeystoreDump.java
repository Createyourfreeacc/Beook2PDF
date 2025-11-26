import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.UnrecoverableEntryException;
import java.security.cert.CertificateException;
import java.util.Enumeration;

import javax.crypto.SecretKey;

/**
 * BUILD:
 * 
 * javac GlobalKeystoreDump.java
 *
 */

/**
 * GlobalKeystoreDump
 *
 * Dumps entries in .global.keystore (JCEKS) with two decoding layers:
 *
 *   Layer 1: raw secretKey bytes  -> hex + ASCII preview
 *   Layer 2: interpret Layer 1 ASCII as hex (if looks like hex) -> hex + ASCII preview
 *
 * masterPassword = "TronkoXbalu.global.keystore8080"
 *
 * Usage:
 *   javac GlobalKeystoreDump.java
 *   java GlobalKeystoreDump "C:\Users\pilot\AppData\Roaming\ionesoft\beook\.global.keystore"
 */
public class GlobalKeystoreDump {

    private static final String KEYSTORE_TYPE = "JCEKS";

    private static final char[] MASTER_PASSWORD =
            "TronkoXbalu.global.keystore8080".toCharArray();

    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("Usage: java GlobalKeystoreDump <path-to-.global.keystore>");
            System.exit(1);
        }

        String keystorePath = args[0];
        File ksFile = new File(keystorePath);

        if (!ksFile.exists()) {
            System.err.println("Keystore file not found: " + ksFile.getAbsolutePath());
            System.exit(2);
        }

        try {
            KeyStore keyStore = loadKeyStore(ksFile, MASTER_PASSWORD);
            dumpSecretEntries(keyStore);
        } catch (Exception e) {
            System.err.println("Error reading keystore: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(3);
        }
    }

    private static KeyStore loadKeyStore(File file, char[] password)
            throws KeyStoreException, IOException, NoSuchAlgorithmException, CertificateException {

        KeyStore ks = KeyStore.getInstance(KEYSTORE_TYPE);
        try (FileInputStream fis = new FileInputStream(file)) {
            ks.load(fis, password);
        }
        return ks;
    }

    private static void dumpSecretEntries(KeyStore ks)
            throws KeyStoreException, NoSuchAlgorithmException, UnrecoverableEntryException {

        Enumeration<String> aliases = ks.aliases();

        while (aliases.hasMoreElements()) {
            String alias = aliases.nextElement();

            if (!ks.isKeyEntry(alias)) {
                continue;
            }

            KeyStore.ProtectionParameter prot = new KeyStore.PasswordProtection(MASTER_PASSWORD);
            KeyStore.Entry entry = ks.getEntry(alias, prot);
            if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                continue;
            }

            SecretKey secretKey = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            byte[] raw = secretKey.getEncoded();

            // alias = user + "@" + service
            String user = alias;
            String service = "";
            int atIndex = alias.indexOf('@');
            if (atIndex >= 0) {
                user = alias.substring(0, atIndex);
                service = alias.substring(atIndex + 1);
            }

            // LAYER 1: raw bytes
            String layer1Hex = bytesToHex(raw);
            String layer1Ascii = bytesToAsciiPreview(raw);

            // LAYER 2: interpret layer1Ascii as hex if it looks like hex
            boolean layer2OK = false;
            String layer2Hex = "";
            String layer2Ascii = "";

            String asciiAsString = new String(raw, StandardCharsets.US_ASCII);
            if (looksLikeHex(asciiAsString)) {
                try {
                    byte[] decoded = hexStringToBytes(asciiAsString);
                    layer2Hex = bytesToHex(decoded);
                    layer2Ascii = bytesToAsciiPreview(decoded);
                    layer2OK = true;
                } catch (IllegalArgumentException ignore) {
                    // if decoding fails, we just skip layer 2
                }
            }

            System.out.println("====================================================");
            System.out.println("Alias     : " + alias);
            System.out.println("User      : " + user);
            System.out.println("Service   : " + service);
            System.out.println("-- Layer 1: raw secret bytes ----------------------");
            System.out.println("Hex       : " + layer1Hex);
            System.out.println("ASCII     : " + layer1Ascii);

            if (layer2OK) {
                System.out.println("-- Layer 2: interpreted Layer1-ASCII as hex -------");
                System.out.println("Hex       : " + layer2Hex);
                System.out.println("ASCII     : " + layer2Ascii);
            }

            System.out.println();
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static String bytesToAsciiPreview(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length);
        for (byte b : bytes) {
            int c = b & 0xff;
            if (c >= 32 && c <= 126) {
                sb.append((char) c);
            } else {
                sb.append('.');
            }
        }
        return sb.toString();
    }

    private static boolean looksLikeHex(String s) {
        String trimmed = s.trim();
        if (trimmed.length() < 2 || trimmed.length() % 2 != 0) {
            return false;
        }
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            boolean isHexChar =
                    (ch >= '0' && ch <= '9') ||
                    (ch >= 'a' && ch <= 'f') ||
                    (ch >= 'A' && ch <= 'F');
            if (!isHexChar) return false;
        }
        return true;
    }

    private static byte[] hexStringToBytes(String s) {
        String trimmed = s.trim();
        int len = trimmed.length();
        if (len % 2 != 0) {
            throw new IllegalArgumentException("Hex string must have even length");
        }
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            int hi = Character.digit(trimmed.charAt(i), 16);
            int lo = Character.digit(trimmed.charAt(i + 1), 16);
            if (hi == -1 || lo == -1) {
                throw new IllegalArgumentException("Invalid hex char in: " + trimmed);
            }
            data[i / 2] = (byte) ((hi << 4) + lo);
        }
        return data;
    }
}
