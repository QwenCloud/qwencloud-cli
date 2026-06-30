/**
 * Command-level tests for `billing payment-method bind`.
 *
 * Validates tri-format output (TUI/TEXT/JSON), browser open success/failure
 * messaging, exit code behavior, and authentication bypass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../../helpers/run-command.js';

const BIND_URL = 'https://home.qwencloud.com/billing/overview?target=payment';

// ─── Mock: openBrowser ───────────────────────────────────────────────────────

const openBrowserMock = vi.fn<(url: string) => boolean>();

vi.mock('../../../../src/utils/open-browser.js', () => ({
  openBrowser: (url: string) => openBrowserMock(url),
}));

// ─── Mock: services (not needed for bind, but command may still resolve) ─────

vi.mock('../../../../src/services/index.js', () => ({
  createServices: () => ({
    billingService: {},
    subscriptionService: { getStatus: vi.fn(), listOrders: vi.fn() },
    apiClient: {},
    authClient: {},
    cache: {},
    freetierService: {},
    codingplanService: {},
    tokenplanService: {},
    modelsService: {},
    usageService: {},
    authService: {},
  }),
}));

// ─── Mock: auth — bind does NOT require authentication ───────────────────────

const ensureAuthenticatedMock = vi.fn();

vi.mock('../../../../src/auth/credentials.js', () => ({
  ensureAuthenticated: (...args: unknown[]) => ensureAuthenticatedMock(...args),
}));

vi.mock('../../../../src/ui/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../../../src/ui/render.js', () => ({
  renderWithInk: vi.fn(),
  renderInteractive: vi.fn(),
  renderWithInkSync: vi.fn(),
}));

const { billingPaymentMethodBindAction } = await import(
  '../../../../src/commands/billing/payment-method/bind.js'
);
const { createClient } = await import('../../../../src/api/client.js');

const getClient = () => createClient();

beforeEach(() => {
  openBrowserMock.mockReset();
  ensureAuthenticatedMock.mockReset();
});

function buildBind(program: import('commander').Command) {
  const billing = program.command('billing');
  const paymentMethod = billing.command('payment-method');
  const bind = paymentMethod.command('bind');
  bind.action(billingPaymentMethodBindAction(bind, getClient));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────────────────────────────────────

describe('billing payment-method bind — browser opened successfully', () => {
  beforeEach(() => {
    openBrowserMock.mockReturnValue(true);
  });

  it('TUI format: outputs green checkmark and the bind URL', async () => {
    const r = await runCommand(buildBind, ['billing', 'payment-method', 'bind']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('✓');
    expect(r.stdout).toContain(BIND_URL);
  });

  it('TEXT format: outputs fallback copy prompt and URL', async () => {
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('If the browser did not open automatically');
    expect(r.stdout).toContain(BIND_URL);
  });

  it('JSON format: outputs structured payload with opened=true', async () => {
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload).toMatchObject({
      bindUrl: BIND_URL,
      opened: true,
    });
    expect(payload.message).toBeDefined();
  });
});

describe('billing payment-method bind — browser failed to open', () => {
  beforeEach(() => {
    openBrowserMock.mockReturnValue(false);
  });

  it('TUI format: outputs yellow warning and the bind URL', async () => {
    const r = await runCommand(buildBind, ['billing', 'payment-method', 'bind']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('⚠');
    expect(r.stdout).toContain(BIND_URL);
  });

  it('TEXT format: outputs manual-copy prompt and URL', async () => {
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'text',
    ]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('Please copy the link below');
    expect(r.stdout).toContain(BIND_URL);
  });

  it('JSON format: outputs structured payload with opened=false', async () => {
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'json',
    ]);
    expect(r.exitCode).toBeUndefined();
    const payload = JSON.parse(r.stdout);
    expect(payload).toMatchObject({
      bindUrl: BIND_URL,
      opened: false,
    });
    expect(payload.message).toBeDefined();
  });
});

describe('billing payment-method bind — behavioral constraints', () => {
  it('exit code is always 0 regardless of browser outcome', async () => {
    openBrowserMock.mockReturnValue(false);
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'json',
    ]);
    // exitCode undefined means no process.exit was called (implicit 0)
    expect(r.exitCode).toBeUndefined();
  });

  it('does NOT call ensureAuthenticated', async () => {
    openBrowserMock.mockReturnValue(true);
    await runCommand(buildBind, ['billing', 'payment-method', 'bind', '--format', 'json']);
    expect(ensureAuthenticatedMock).not.toHaveBeenCalled();
  });

  it('bind URL is the fixed management page URL', async () => {
    openBrowserMock.mockReturnValue(true);
    const r = await runCommand(buildBind, [
      'billing', 'payment-method', 'bind', '--format', 'json',
    ]);
    const payload = JSON.parse(r.stdout);
    expect(payload.bindUrl).toBe(BIND_URL);
  });
});
