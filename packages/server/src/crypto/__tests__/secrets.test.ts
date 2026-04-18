// crypto/__tests__/secrets.test.ts
// Unit tests for Phase 9 D-17/D-18 AES-256-GCM envelope encryption.
// No DB — getOrCreateOrgDek is covered in Plan 09-03 isolation tests.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretDecryptError } from '../../errors.js';
import {
  decryptSecret,
  encryptSecret,
  unwrapDek,
  wrapDek,
} from '../secrets.js';

describe('encryptSecret / decryptSecret', () => {
  it('round-trip returns original plaintext', () => {
    const dek = randomBytes(32);
    const aad = 'org_abc:MY_SECRET';
    const plaintext = 'super-secret-value';

    const { ciphertext, iv, tag } = encryptSecret(dek, plaintext, aad);
    const result = decryptSecret(dek, ciphertext, iv, tag, aad);

    expect(result).toBe(plaintext);
  });

  it('two encryptSecret calls with same inputs produce different ivs and ciphertexts (SEC-02)', () => {
    const dek = randomBytes(32);
    const plaintext = 'same-value';
    const aad = 'org_abc:KEY';

    const first = encryptSecret(dek, plaintext, aad);
    const second = encryptSecret(dek, plaintext, aad);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('decryptSecret throws SecretDecryptError when auth tag is tampered', () => {
    const dek = randomBytes(32);
    const aad = 'org_abc:TAMPER_TAG';
    const { ciphertext, iv, tag } = encryptSecret(dek, 'value', aad);

    // Flip first byte of tag
    const tamperedTag = Buffer.from(tag);
    tamperedTag.writeUInt8((tamperedTag.readUInt8(0) ^ 0xff), 0);

    expect(() => decryptSecret(dek, ciphertext, iv, tamperedTag, aad)).toThrowError(
      SecretDecryptError,
    );
  });

  it('decryptSecret throws SecretDecryptError when iv is tampered', () => {
    const dek = randomBytes(32);
    const aad = 'org_abc:TAMPER_IV';
    const { ciphertext, iv, tag } = encryptSecret(dek, 'value', aad);

    const tamperedIv = Buffer.from(iv);
    tamperedIv.writeUInt8((tamperedIv.readUInt8(0) ^ 0xff), 0);

    expect(() => decryptSecret(dek, ciphertext, tamperedIv, tag, aad)).toThrowError(
      SecretDecryptError,
    );
  });

  it('decryptSecret throws SecretDecryptError when aad differs (cross-org tampering — D-16)', () => {
    const dek = randomBytes(32);
    const originalAad = 'org_abc:KEY';
    const wrongAad = 'org_xyz:KEY'; // different org
    const { ciphertext, iv, tag } = encryptSecret(dek, 'value', originalAad);

    expect(() => decryptSecret(dek, ciphertext, iv, tag, wrongAad)).toThrowError(
      SecretDecryptError,
    );
  });

  it('decryptSecret throws SecretDecryptError when ciphertext is tampered', () => {
    const dek = randomBytes(32);
    const aad = 'org_abc:TAMPER_CT';
    const { ciphertext, iv, tag } = encryptSecret(dek, 'hello world', aad);

    const tamperedCt = Buffer.from(ciphertext);
    tamperedCt.writeUInt8((tamperedCt.readUInt8(0) ^ 0xff), 0);

    expect(() => decryptSecret(dek, tamperedCt, iv, tag, aad)).toThrowError(SecretDecryptError);
  });
});

describe('wrapDek / unwrapDek', () => {
  it('round-trip returns identical DEK buffer', () => {
    const mek = randomBytes(32);
    const dek = randomBytes(32);

    const { wrapped, iv, tag } = wrapDek(mek, dek);
    const recovered = unwrapDek(mek, wrapped, iv, tag);

    expect(recovered).toEqual(dek);
  });

  it('two wrapDek calls with same inputs produce different wrapped outputs and ivs', () => {
    const mek = randomBytes(32);
    const dek = randomBytes(32);

    const first = wrapDek(mek, dek);
    const second = wrapDek(mek, dek);

    expect(first.iv).not.toEqual(second.iv);
    expect(first.wrapped).not.toEqual(second.wrapped);
  });
});

describe('SecretDecryptError discipline', () => {
  it('error message contains no plaintext, tag, or iv fragment (SEC-03 / D-10)', () => {
    const dek = randomBytes(32);
    const aad = 'org_abc:DISC';
    const plaintext = 'very-secret-value-should-not-appear';
    const { ciphertext, iv, tag } = encryptSecret(dek, plaintext, aad);

    const tamperedTag = Buffer.from(tag);
    tamperedTag.writeUInt8((tamperedTag.readUInt8(0) ^ 0xff), 0);

    let caught: SecretDecryptError | undefined;
    try {
      decryptSecret(dek, ciphertext, iv, tamperedTag, aad);
    } catch (err) {
      if (err instanceof SecretDecryptError) caught = err;
    }

    expect(caught).toBeDefined();
    // Error message must not contain hex-encoded iv, tag, or plaintext fragments
    const msg = caught!.message;
    expect(msg).not.toContain(iv.toString('hex'));
    expect(msg).not.toContain(tag.toString('hex'));
    expect(msg).not.toContain(plaintext);
  });
});
