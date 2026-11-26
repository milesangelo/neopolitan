import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SecretStore {
  readonly sealingKind: 'os-keychain' | 'host-key' | 'none';
  isAvailable(): Promise<boolean>;
  seal(plaintext: string): Promise<string>;
  unseal(ciphertext: string): Promise<string>;
}

export class InMemorySecretStore implements SecretStore {
  readonly sealingKind = 'none' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async seal(plaintext: string): Promise<string> {
    return Buffer.from(plaintext, 'utf8').toString('base64');
  }

  async unseal(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext, 'base64').toString('utf8');
  }
}

/**
 * Headless AES-256-GCM host-file SecretStore (Orca `orcad-secret-store` pattern)
 * for environments without an unlocked desktop OS keychain.
 */
export class EncryptedHostFileSecretStore implements SecretStore {
  readonly sealingKind = 'host-key' as const;
  private cachedKey?: Buffer;

  constructor(private readonly keyFilePath: string) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private async getOrCreateKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;
    try {
      const hex = (await fs.readFile(this.keyFilePath, 'utf8')).trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) {
        this.cachedKey = buf;
        return buf;
      }
    } catch {
      // create below
    }
    const key = randomBytes(32);
    await fs.mkdir(path.dirname(this.keyFilePath), { recursive: true });
    await fs.writeFile(this.keyFilePath, key.toString('hex'), { mode: 0o600 });
    this.cachedKey = key;
    return key;
  }

  async seal(plaintext: string): Promise<string> {
    const key = await this.getOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async unseal(ciphertext: string): Promise<string> {
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid sealed secret format');
    }
    const key = await this.getOrCreateKey();
    const iv = Buffer.from(parts[1]!, 'hex');
    const tag = Buffer.from(parts[2]!, 'hex');
    const data = Buffer.from(parts[3]!, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

/**
 * Computes Claude Code's macOS Keychain service name suffix for isolated `CLAUDE_CONFIG_DIR`
 * folders (`Claude Code-credentials-<sha256_nfc_8hex>`, ported from Orca).
 */
export function computeClaudeKeychainServiceName(configDir?: string): string {
  if (!configDir) return 'Claude Code-credentials';
  const normalized = configDir.normalize('NFC');
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}
