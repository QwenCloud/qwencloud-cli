/**
 * Unit tests for PKCE primitives and auth-mode selection.
 *
 * Covers RFC 7636 §4.1 / §4.2 conformance for the locally-generated
 * code_verifier and the SHA-256 / base64url-derived code_challenge,
 * plus the selectAuthMode decision function used to pick between PKCE
 * (default) and Device Flow (compat fallback).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  selectAuthMode,
  generateCodeVerifier,
  deriveCodeChallenge,
  type AuthMode,
} from '../../src/auth/pkce.js';

describe('generateCodeVerifier', () => {
  it('returns a string within the RFC 7636 length window (43..128)', () => {
    const v = generateCodeVerifier();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('uses only the RFC 7636 unreserved character alphabet', () => {
    for (let i = 0; i < 32; i++) {
      const v = generateCodeVerifier();
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it('produces high-entropy values (no two consecutive calls collide)', () => {
    const sample = new Set<string>();
    for (let i = 0; i < 64; i++) {
      sample.add(generateCodeVerifier());
    }
    expect(sample.size).toBe(64);
  });
});

describe('deriveCodeChallenge', () => {
  it('is deterministic: identical verifiers produce identical challenges', () => {
    const verifier = 'verifier-fixture-value-aaaaaaaaaaaaaaaaaaaaaaaa';
    const a = deriveCodeChallenge(verifier);
    const b = deriveCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it('is collision-resistant: different verifiers produce different challenges', () => {
    const a = deriveCodeChallenge('verifier-fixture-value-aaaaaaaaaaaaaaaaaaaaaaaa');
    const b = deriveCodeChallenge('verifier-fixture-value-bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(a).not.toBe(b);
  });

  it('uses base64url alphabet without padding', () => {
    const challenge = deriveCodeChallenge('verifier-fixture-value-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.endsWith('=')).toBe(false);
  });

  it('matches the RFC 7636 Appendix B test vector', () => {
    // RFC 7636 Appendix B
    //   verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    //   challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });
});

describe('selectAuthMode', () => {
  // Snapshot/restore the env var so individual cases stay isolated.
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.QWENCLOUD_AUTH_MODE;
    delete process.env.QWENCLOUD_AUTH_MODE;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.QWENCLOUD_AUTH_MODE;
    } else {
      process.env.QWENCLOUD_AUTH_MODE = savedEnv;
    }
  });

  // PK-SAM-01
  it('returns the forcedMode when explicitly provided (pkce)', () => {
    const mode: AuthMode = selectAuthMode({ forcedMode: 'pkce' });
    expect(mode).toBe('pkce');
  });

  // PK-SAM-02
  it('returns the forcedMode when explicitly provided (device-flow), even if env says pkce', () => {
    process.env.QWENCLOUD_AUTH_MODE = 'pkce';
    const mode: AuthMode = selectAuthMode({ forcedMode: 'device-flow' });
    expect(mode).toBe('device-flow');
  });

  // PK-SAM-03
  it('honours envOverride=pkce', () => {
    expect(selectAuthMode({ envOverride: 'pkce' })).toBe('pkce');
  });

  // PK-SAM-04
  it('honours envOverride=device-flow', () => {
    expect(selectAuthMode({ envOverride: 'device-flow' })).toBe('device-flow');
  });

  // PK-SAM-05
  it('reads QWENCLOUD_AUTH_MODE at call time when ctx.envOverride is omitted', () => {
    process.env.QWENCLOUD_AUTH_MODE = 'device-flow';
    expect(selectAuthMode()).toBe('device-flow');
  });

  // PK-SAM-06
  it('falls back to pkce when env var is empty / unset', () => {
    expect(selectAuthMode()).toBe('pkce');
    expect(selectAuthMode({})).toBe('pkce');
  });

  // PK-SAM-07
  it('falls back to pkce when env var holds an unrecognised value', () => {
    process.env.QWENCLOUD_AUTH_MODE = 'foo';
    expect(selectAuthMode()).toBe('pkce');
  });

  it('does not cache env var lookup across calls (immediate re-read)', () => {
    process.env.QWENCLOUD_AUTH_MODE = 'device-flow';
    expect(selectAuthMode()).toBe('device-flow');
    delete process.env.QWENCLOUD_AUTH_MODE;
    expect(selectAuthMode()).toBe('pkce');
  });
});
