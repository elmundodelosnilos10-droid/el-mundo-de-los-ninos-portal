import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const backupObjectPath = key => `objects/${sha256(key)}.enc`;

export async function deriveBackupKey(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 20) throw Error("La frase de respaldo debe tener al menos 20 caracteres.");
  return Buffer.from(await scrypt(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
}

export function encryptBackupFile(plain, key, label) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(label));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackupFile(ciphertext, key, label) {
  if (ciphertext.length < 28) throw Error("El archivo cifrado está incompleto.");
  const iv = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]);
}
