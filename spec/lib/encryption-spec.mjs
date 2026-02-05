'use strict';

import {
  encryptWithPassword,
  decryptWithPassword,
  encryptWithKey,
  decryptWithKey,
  generateKey,
  hashPassword,
  verifyPassword,
} from '../../server/encryption.mjs';

describe('Encryption module', () => {
  describe('encryptWithPassword / decryptWithPassword', () => {
    it('should encrypt and decrypt data correctly', async () => {
      let plaintext = 'Hello, World!';
      let password  = 'test-password-123';

      let encrypted = await encryptWithPassword(plaintext, password);
      let decrypted = await decryptWithPassword(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      let plaintext = 'Same text';
      let password  = 'same-password';

      let encrypted1 = await encryptWithPassword(plaintext, password);
      let encrypted2 = await encryptWithPassword(plaintext, password);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail to decrypt with wrong password', async () => {
      let plaintext       = 'Secret data';
      let correctPassword = 'correct-password';
      let wrongPassword   = 'wrong-password';

      let encrypted = await encryptWithPassword(plaintext, correctPassword);

      await expectAsync(decryptWithPassword(encrypted, wrongPassword))
        .toBeRejectedWithError(/Decryption failed/);
    });

    it('should handle empty strings', async () => {
      let encrypted = await encryptWithPassword('', 'password');
      let decrypted = await decryptWithPassword(encrypted, 'password');

      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', async () => {
      let plaintext = 'Hello, World!';
      let password  = 'test-password';

      let encrypted = await encryptWithPassword(plaintext, password);
      let decrypted = await decryptWithPassword(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long passwords', async () => {
      let plaintext = 'Test data';
      let password  = 'a'.repeat(1000);

      let encrypted = await encryptWithPassword(plaintext, password);
      let decrypted = await decryptWithPassword(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('encryptWithKey / decryptWithKey', () => {
    it('should encrypt and decrypt with hex key', () => {
      let plaintext = 'Test data';
      let key       = generateKey();

      let encrypted = encryptWithKey(plaintext, key);
      let decrypted = decryptWithKey(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      let plaintext = 'Same text';
      let key       = generateKey();

      let encrypted1 = encryptWithKey(plaintext, key);
      let encrypted2 = encryptWithKey(plaintext, key);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail with wrong key', () => {
      let plaintext = 'Secret';
      let key1      = generateKey();
      let key2      = generateKey();

      let encrypted = encryptWithKey(plaintext, key1);

      expect(() => decryptWithKey(encrypted, key2)).toThrowError(/Decryption failed/);
    });

    it('should reject invalid key length', () => {
      let plaintext = 'Test';
      let shortKey  = 'abc123';

      expect(() => encryptWithKey(plaintext, shortKey)).toThrowError(/Invalid key length/);
    });
  });

  describe('generateKey', () => {
    it('should generate a 64-character hex string (256 bits)', () => {
      let key = generateKey();

      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique keys', () => {
      let keys = new Set();

      for (let i = 0; i < 100; i++)
        keys.add(generateKey());

      expect(keys.size).toBe(100);
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('should hash and verify passwords correctly', async () => {
      let password = 'my-secure-password';

      let hash  = await hashPassword(password);
      let valid = await verifyPassword(password, hash);

      expect(valid).toBe(true);
    });

    it('should reject wrong passwords', async () => {
      let password = 'correct-password';
      let wrong    = 'wrong-password';

      let hash  = await hashPassword(password);
      let valid = await verifyPassword(wrong, hash);

      expect(valid).toBe(false);
    });

    it('should produce different hashes for same password (random salt)', async () => {
      let password = 'same-password';

      let hash1 = await hashPassword(password);
      let hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('should hash in salt:hash format', async () => {
      let hash = await hashPassword('test');

      expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    });

    it('should reject malformed hashes', async () => {
      let valid = await verifyPassword('test', 'not-a-valid-hash');

      expect(valid).toBe(false);
    });
  });
});
