import { describe, expect, it, vi } from 'vitest';
import { getDefaultPlugins, getDefaultPlugin } from '../../src/plugins/defaults.js';

describe('host default plugin configuration', () => {
  it('ships no preinstalled plugin identities and performs no network request', () => {
    const fetch = vi.fn(() => {
      throw new Error('Default discovery must remain offline');
    });
    vi.stubGlobal('fetch', fetch);
    try {
      expect(getDefaultPlugins()).toEqual([]);
      expect(getDefaultPlugin('@qwencloud/not-configured')).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
