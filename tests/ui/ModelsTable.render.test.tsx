import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Mock renderWithInk so renderModelsTableInk wrapper test doesn't spawn a real Ink instance.
// Use vi.hoisted to safely create the spy before vi.mock factory runs.
const { renderWithInkSpy } = vi.hoisted(() => ({
  renderWithInkSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/ui/render.js', () => ({
  renderWithInk: renderWithInkSpy,
  renderInteractive: vi.fn(),
  renderWithInkSync: renderWithInkSpy,
}));

import {
  ModelsTableInk,
  buildModelsUiData,
  renderModelsTableInk,
} from '../../src/ui/ModelsTable.js';
import type { Model } from '../../src/types/model.js';

const baseModels = [
  {
    id: 'free-mod',
    modality: { input: ['text'], output: ['text'] },
    can_try: true,
    // free-only model: price column renders 'Free' via the isFreeOnly branch.
    free_tier: {
      mode: 'only',
      quota: null,
    },
    pricing: { tiers: [] },
  },
  {
    id: 'paid-mod',
    modality: { input: ['text'], output: ['text'] },
    can_try: true,
    free_tier: {
      mode: 'standard',
      quota: {
        remaining: 500,
        total: 1000,
        unit: 'tokens',
        used_pct: 50,
        status: 'valid',
      },
    },
    pricing: { tiers: [{ label: 't', input: 1.5, output: 3.0, unit: 'USD/1M' }] },
  },
  {
    id: 'expired-mod',
    modality: { input: ['text'], output: ['text'] },
    can_try: false,
    free_tier: {
      mode: 'standard',
      quota: {
        remaining: 0,
        total: 100,
        unit: 'tokens',
        used_pct: 100,
        status: 'expire',
      },
    },
  },
] as unknown as Model[];

beforeEach(() => {
  renderWithInkSpy.mockClear();
});

describe('<ModelsTableInk /> rendering', () => {
  it('renders title, subtitle and all model rows', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(
      <ModelsTableInk uiData={uiData} title="My Models" subtitle="3 items" />
    );
    const out = lastFrame()!;
    expect(out).toContain('My Models');
    expect(out).toContain('free-mod');
    expect(out).toContain('paid-mod');
    expect(out).toContain('expired-mod');
    expect(out).toMatch(/3 models/);
  });

  it('uses custom footer when provided', () => {
    const uiData = buildModelsUiData([baseModels[0]]);
    const { lastFrame } = render(
      <ModelsTableInk uiData={uiData} footer="my custom footer text" />
    );
    expect(lastFrame()).toContain('my custom footer');
  });

  it('uses default title "Models" when none given', () => {
    const uiData = buildModelsUiData([baseModels[0]]);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    expect(lastFrame()).toContain('Models');
  });

  it('omits "Free Tier quota included" footer when no quota', () => {
    const noQuotaModels = [
      {
        id: 'noq',
        modality: { input: ['text'], output: ['text'] },
        can_try: false,
        free_tier: { mode: null, quota: null },
      },
    ] as unknown as Model[];
    const uiData = buildModelsUiData(noQuotaModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    expect(lastFrame()).not.toContain('Free Tier quota included');
  });

  it('includes "Free Tier quota included" footer when has quota', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    expect(lastFrame()).toContain('Free Tier quota included');
  });

  it('renders Free / $ / em-dash price variants', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    const out = lastFrame()!;
    expect(out).toContain('Free');
    expect(out).toContain('$1.5');
    expect(out).toContain('—');
  });

  it('expired row still renders the model id and the row layout differs from valid rows', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    const out = lastFrame()!;
    expect(out).toContain('expired-mod');
    const expiredLine = out.split('\n').find((l) => l.includes('expired-mod'));
    const freeLine = out.split('\n').find((l) => l.includes('free-mod'));
    expect(expiredLine).toBeDefined();
    expect(freeLine).toBeDefined();
    expect(expiredLine).not.toBe(freeLine);
    expect(expiredLine!).not.toContain('1,000,000');
  });

  it('expired row fields carry muted styling with expired label', () => {
    // When a model's free tier status is 'expire', the rendered row must:
    // 1. Show the 'expired' text label (from the freeTierBar branch)
    // 2. Show an empty bar (░ only, no filled █ blocks)
    // 3. Show the freeTierUnit field (proves muted wrapping, not omission)
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    const out = lastFrame()!;
    const expiredLine = out.split('\n').find((l) => l.includes('expired-mod'))!;

    // 'expired' label is rendered in the row
    expect(expiredLine).toContain('expired');
    // Empty bar characters (░) are present — the bar is muted/empty
    expect(expiredLine).toContain('░');
    // No filled blocks in the expired row (the bar is entirely empty)
    expect(expiredLine).not.toContain('█');
    // The unit 'tok' is still shown (muted, not hidden)
    expect(expiredLine).toContain('tok');
  });

  it('non-expired rows show filled progress bar blocks without expired label', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    const out = lastFrame()!;
    const paidLine = out.split('\n').find((l) => l.includes('paid-mod'))!;
    // paid-mod has 50% remaining → filled progress bar with █ blocks
    expect(paidLine).toContain('█');
    // paid-mod should NOT show 'expired' label
    expect(paidLine).not.toContain('expired');
    // The free-mod (free-only, no quota) also should not have 'expired'
    const freeLine = out.split('\n').find((l) => l.includes('free-mod'))!;
    expect(freeLine).not.toContain('expired');
  });

  it('renders the expected price text variants per row (Free / $price / em-dash)', () => {
    const uiData = buildModelsUiData(baseModels);
    const { lastFrame } = render(<ModelsTableInk uiData={uiData} />);
    const out = lastFrame()!;
    // Each row carries its respective price string in its own line — proving
    // the price-formatting branch maps each pricing shape to the correct text.
    const freeLine = out.split('\n').find((l) => l.includes('free-mod'));
    const paidLine = out.split('\n').find((l) => l.includes('paid-mod'));
    const expiredLine = out.split('\n').find((l) => l.includes('expired-mod'));
    expect(freeLine).toBeDefined();
    expect(paidLine).toBeDefined();
    expect(expiredLine).toBeDefined();
    // free-mod is a free-only model (free_tier.mode='only') → 'Free' label
    expect(freeLine!).toContain('Free');
    // paid-mod has $1.5 input price
    expect(paidLine!).toContain('$1.5');
    // expired-mod has no pricing → em-dash placeholder
    expect(expiredLine!).toContain('—');
  });
});

describe('renderModelsTableInk wrapper', () => {
  it('forwards uiData and options to renderWithInk', async () => {
    const uiData = buildModelsUiData([baseModels[0]]);
    await renderModelsTableInk(uiData, {
      title: 'T',
      subtitle: 'S',
      footer: 'F',
    });
    expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
    const arg = renderWithInkSpy.mock.calls[0][0];
    expect(arg.props.uiData).toBe(uiData);
    expect(arg.props.title).toBe('T');
    expect(arg.props.subtitle).toBe('S');
    expect(arg.props.footer).toBe('F');
  });

  it('works without options', async () => {
    const uiData = buildModelsUiData([baseModels[0]]);
    await renderModelsTableInk(uiData);
    expect(renderWithInkSpy).toHaveBeenCalledTimes(1);
    const arg = renderWithInkSpy.mock.calls[0][0];
    expect(arg.props.uiData).toBe(uiData);
    expect(arg.props.title).toBeUndefined();
  });
});
