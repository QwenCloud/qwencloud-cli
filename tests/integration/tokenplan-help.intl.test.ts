import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from './helpers.js';

const { authSpies, networkSpy, browserSpy } = vi.hoisted(() => ({
  authSpies: {
    ensureAuthenticated: vi.fn(() => {
      throw new Error('Help must not require authentication');
    }),
    resolveCredentials: vi.fn(() => {
      throw new Error('Help must not resolve credentials');
    }),
    readCredentials: vi.fn(() => {
      throw new Error('Help must not read credentials');
    }),
    getCurrentUser: vi.fn(() => {
      throw new Error('Help must not read account identity');
    }),
  },
  networkSpy: vi.fn(() => {
    throw new Error('Help must not request the network');
  }),
  browserSpy: vi.fn(() => {
    throw new Error('Help must not open a browser');
  }),
}));

vi.mock('../../src/auth/credentials.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...authSpies,
}));
vi.mock('../../src/config/manager.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getEffectiveConfig: vi.fn(() => ({})),
  getConfigValue: vi.fn(() => undefined),
}));
vi.mock('../../src/utils/open-browser.js', () => ({ openBrowser: browserSpy }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', networkSpy);
});

afterEach(() => {
  try {
    expect(authSpies.ensureAuthenticated).not.toHaveBeenCalled();
    expect(authSpies.resolveCredentials).not.toHaveBeenCalled();
    expect(authSpies.readCredentials).not.toHaveBeenCalled();
    expect(authSpies.getCurrentUser).not.toHaveBeenCalled();
    expect(networkSpy).not.toHaveBeenCalled();
    expect(browserSpy).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('Token Plan command help', () => {
  it('shows the parent group help without selecting an edition', async () => {
    const result = await runCommand(['subscription', 'tokenplan']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage');
    expect(result.stdout).toContain('list');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain(
      'Show Token Plan subscriptions, validity, auto-renewal and remaining quotas.',
    );
    expect(result.stdout).not.toContain('addons');
  });

  it('documents the public catalog, supported cycles, defaults and examples', async () => {
    const result = await runCommand(['subscription', 'tokenplan', 'list', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'List Token Plan prices, quota windows and optional supported models.',
    );
    expect(result.stdout).not.toContain(
      'Anonymous public catalogs are available without signing in.',
    );
    expect(result.stdout).not.toContain(
      'Prices apply to the selected billing cycle; credit quota reset windows are independent.',
    );
    expect(result.stdout).not.toContain(
      'Individual plans support monthly, quarterly and yearly billing; team plans support monthly and yearly billing.',
    );
    expect(result.stdout).toContain('--edition');
    expect(result.stdout).toContain('Edition to display: all, individual, team (default: all)');
    expect(result.stdout).toContain('--billing-cycle');
    expect(result.stdout).toMatch(/monthly[\s|,]+quarterly[\s|,]+yearly/);
    expect(result.stdout).toContain('--include-models');
    expect(result.stdout).toMatch(/default[^\n]*all/i);
    expect(result.stdout).toMatch(/default[^\n]*monthly/i);
    expect(result.stdout).toContain('You can view Token Plan prices without logging in.');
    expect(result.stdout).toContain('Examples');
    expect(result.stdout).toMatch(/tokenplan\s+list\s+--edition\s+individual/);
    expect(result.stdout).not.toContain('--include-harness');
    expect(result.stdout).not.toContain('concurrentAgents');
  });

  it('documents selected subscription status and distinct expiry and reset meanings', async () => {
    const result = await runCommand(['subscription', 'tokenplan', 'status', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Show Token Plan subscriptions, validity, auto-renewal and remaining quotas.',
    );
    expect(result.stdout).toContain('--edition');
    expect(result.stdout).toMatch(/individual[\s|,]+team[\s|,]+all/);
    expect(result.stdout).toMatch(/default[^\n]*all/i);
    expect(result.stdout).toContain('\n\n    Individual results include tiers.');
    expect(result.stdout.replace(/\s+/g, ' ')).toContain(
      'Team results include seatSummaries grouped by seatType. Each seat summary includes seatType, seatCount, totalCredits, remainingCredits, remainingPct and resetAt.',
    );
    expect(result.stdout).toContain(
      '\n\n    endAt is subscription validity; resetAt is the Credit reset time.',
    );
    expect(result.stdout).toContain('Examples');
    expect(result.stdout).not.toContain('Show your Token Plan subscriptions');
    expect(result.stdout).not.toContain('Team Credits are totals');
    expect(result.stdout).not.toContain('harnessAllowances');
    expect(result.stdout).not.toContain('--subscription-id');
    expect(result.stdout).not.toContain('--include-harness');
    expect(result.stdout.indexOf('Examples:')).toBeLessThan(
      result.stdout.indexOf('Individual results include'),
    );
    expect(result.stdout).not.toContain('JSON output:');
    expect(result.stdout).not.toContain('Collections may be empty or omitted');
    expect(result.stdout).not.toMatch(/\n\n\n    Individual results/);
  });

  it.each([40, 60, 120])('aligns status explanations at %s columns', async (columns) => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
    try {
      const result = await runCommand(['subscription', 'tokenplan', 'status', '--help']);
      const explanations = result.stdout.slice(result.stdout.indexOf('    Individual results'));
      expect(result.exitCode).toBe(0);
      expect(explanations.replace(/\s+/g, ' ')).toContain(
        'Each seat summary includes seatType, seatCount, totalCredits, remainingCredits, remainingPct and resetAt.',
      );
      expect(explanations.replace(/\s+/g, ' ')).toContain(
        'endAt is subscription validity; resetAt is the Credit reset time.',
      );
      for (const line of explanations.split('\n').filter(Boolean)) {
        expect(line).toMatch(/^    \S/);
        expect(line.length).toBeLessThanOrEqual(Math.min(80, columns - 1));
      }
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'columns', descriptor);
      else Reflect.deleteProperty(process.stdout, 'columns');
    }
  });

  it('documents the explicit login command and confirmed purchase-status wording', async () => {
    const result = await runCommand(['subscription', 'tokenplan', 'list', '--help']);
    expect(result.stdout).toContain(
      'To view your subscription status and account-specific availability, run:\n    qwencloud auth login',
    );
    expect(result.stdout).toContain(
      'Your purchase status shown here is for reference only. Your eligibility will be verified again before purchase.',
    );
    expect(result.stdout).not.toContain('Log in to also view');
    expect(result.stdout).not.toContain('Availability shown here is for reference.');
  });

  it.each([
    ['list', '--edition', '--help'],
    ['list', '--billing-cycle', '-h'],
    ['list', '--format', '--help'],
    ['status', '--edition', '-h'],
    ['status', '--format', '--help'],
  ])('handles a help flag swallowed by %s %s', async (leaf, flag, help) => {
    const result = await runCommand(['subscription', 'tokenplan', leaf, flag, help]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage');
    expect(result.stdout).toContain(`tokenplan ${leaf}`);
    expect(result.stderr).toBe('');
  });
});
