import { describe, expect, it } from 'vitest';
import { isCredentialToken } from '../../src/auth/credential-token.js';

describe('Opaque credential token validation', () => {
  it.each([
    'mock-derived-credential',
    'mock.jwt.parts',
    'mock*credential.test',
    '*mock-credential',
    'mock-credential*',
    'mock***masked',
  ])('accepts an unmasked nonempty opaque token %s', (token) => {
    expect(isCredentialToken(token)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'mock credential',
    'mock\tcredential',
    'mock\ncredential',
    ' mock-credential',
    'mock-credential ',
    'REDACTED',
    'redacted',
    '[REDACTED]',
    '[redacted]',
    '<REDACTED>',
    '<redacted>',
    'omitted',
    'OMITTED',
    '<omitted>',
    '<OMITTED>',
    '*',
    '***',
    '*****',
    null,
    undefined,
    {},
    123,
  ])('rejects absent or redacted credential material: %j', (token) => {
    expect(isCredentialToken(token)).toBe(false);
  });
});
