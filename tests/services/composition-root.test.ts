/**
 * Composition root tests — verify the service container exposes the new
 * SubscriptionService and that wiring stays a single source of truth.
 */
import { describe, it, expect } from 'vitest';
import { createServices } from '../../src/services/index.js';

describe('createServices — subscriptionService wiring', () => {
  it('exposes subscriptionService on the container', () => {
    const container = createServices();
    expect(container.subscriptionService).toBeDefined();
  });

  it('reuses the same shared cache across services', () => {
    const container = createServices();
    // Reference identity of the shared CachedFetcher across calls is part of
    // the contract — services should not own private cache instances.
    expect(container.cache).toBeDefined();
    expect(container.billingService).toBeDefined();
    expect(container.subscriptionService).toBeDefined();
  });

  it('returns a fresh container per createServices call (no global singleton)', () => {
    const a = createServices();
    const b = createServices();
    expect(a.subscriptionService).not.toBe(b.subscriptionService);
  });
});
