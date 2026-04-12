import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY env var not set");
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Output: base64(iv):base64(ciphertext):base64(authTag)
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${authTag.toString("base64")}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input: base64(iv):base64(ciphertext):base64(authTag)
 */
export function decryptToken(encrypted: string): string {
  const key = getKey();
  const [ivB64, ctB64, tagB64] = encrypted.split(":");
  if (!ivB64 || !ctB64 || !tagB64)
    throw new Error("Invalid encrypted format — expected iv:ct:tag");

  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
