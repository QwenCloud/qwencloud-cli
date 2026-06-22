/**
 * Re-export integrity test for the view-models top-level bucket.
 *
 * iter-4 reorganises `src/view-models/{models,usage,doctor}.ts` into
 * sub-directories with their own `index.ts`. The TOP-level
 * `src/view-models/index.ts` must continue to re-export every value and
 * type listed in scope §3 — this is the contract that command/UI layers
 * import against.
 *
 * Two layers of assertion:
 *   1. Runtime: every value export is a function (would be `undefined` if
 *      the bucket forgot to re-export it).
 *   2. Compile-time: every type export is named in an `import type { ... }`
 *      statement, which fails `tsc --noEmit` if any name is missing or
 *      renamed.
 */
import { describe, it, expect } from 'vitest';
import * as ViewModels from '../../src/view-models/index.js';
import type {
  ModelRowViewModel,
  ModelsListViewModel,
  ModelDetailViewModel,
  PricingLineViewModel,
  BuiltInToolViewModel,
  ContextViewModel,
  FreeTierSummaryViewModel,
  UsageSummaryViewModel,
  FreeTierSectionViewModel,
  FreeTierRowViewModel,
  CodingPlanSectionViewModel,
  CodingPlanWindowViewModel,
  PayAsYouGoSectionViewModel,
  PayAsYouGoRowViewModel,
  UsageBreakdownViewModel,
  BreakdownColumn,
  BreakdownRowViewModel,
  BreakdownTotalViewModel,
  DoctorViewModel,
  DoctorCheckViewModel,
  DoctorCheck,
} from '../../src/view-models/index.js';

describe('view-models bucket — value re-exports', () => {
  it('re-exports buildModelListViewModel', () => {
    expect(typeof ViewModels.buildModelListViewModel).toBe('function');
  });

  it('re-exports buildModelListViewModelFromModels', () => {
    expect(typeof ViewModels.buildModelListViewModelFromModels).toBe('function');
  });

  it('re-exports buildModelDetailViewModel', () => {
    expect(typeof ViewModels.buildModelDetailViewModel).toBe('function');
  });

  it('re-exports buildUsageSummaryViewModel', () => {
    expect(typeof ViewModels.buildUsageSummaryViewModel).toBe('function');
  });

  it('re-exports buildUsageBreakdownViewModel', () => {
    expect(typeof ViewModels.buildUsageBreakdownViewModel).toBe('function');
  });

  it('re-exports buildDoctorViewModel', () => {
    expect(typeof ViewModels.buildDoctorViewModel).toBe('function');
  });

  it('re-exports formatFreeTierSplit (transit-through requirement)', () => {
    expect(typeof ViewModels.formatFreeTierSplit).toBe('function');
  });

  it('re-exports formatFreeTier (transit-through requirement)', () => {
    expect(typeof ViewModels.formatFreeTier).toBe('function');
  });

  it('re-exports formatPriceFromPricing (transit-through requirement)', () => {
    expect(typeof ViewModels.formatPriceFromPricing).toBe('function');
  });
});

describe('view-models bucket — type re-exports (compile-time)', () => {
  it('exposes every type listed in scope §3', () => {
    // The act of importing each type at the top of this file is the actual
    // assertion — `tsc --noEmit` fails if any name is missing. The runtime
    // body below uses each type in an unused declaration to keep linters
    // from stripping the import. No runtime behaviour is asserted.
    const _placeholders: Array<unknown> = [];
    const _row: ModelRowViewModel | undefined = undefined;
    const _list: ModelsListViewModel | undefined = undefined;
    const _detail: ModelDetailViewModel | undefined = undefined;
    const _pricing: PricingLineViewModel | undefined = undefined;
    const _tool: BuiltInToolViewModel | undefined = undefined;
    const _ctx: ContextViewModel | undefined = undefined;
    const _ftSummary: FreeTierSummaryViewModel | undefined = undefined;
    const _usageSummary: UsageSummaryViewModel | undefined = undefined;
    const _ftSection: FreeTierSectionViewModel | undefined = undefined;
    const _ftRow: FreeTierRowViewModel | undefined = undefined;
    const _cpSection: CodingPlanSectionViewModel | undefined = undefined;
    const _cpWindow: CodingPlanWindowViewModel | undefined = undefined;
    const _paygSection: PayAsYouGoSectionViewModel | undefined = undefined;
    const _paygRow: PayAsYouGoRowViewModel | undefined = undefined;
    const _bdView: UsageBreakdownViewModel | undefined = undefined;
    const _bdCol: BreakdownColumn | undefined = undefined;
    const _bdRow: BreakdownRowViewModel | undefined = undefined;
    const _bdTotal: BreakdownTotalViewModel | undefined = undefined;
    const _doctor: DoctorViewModel | undefined = undefined;
    const _doctorCheckVm: DoctorCheckViewModel | undefined = undefined;
    const _doctorCheck: DoctorCheck | undefined = undefined;
    _placeholders.push(
      _row, _list, _detail, _pricing, _tool, _ctx, _ftSummary, _usageSummary,
      _ftSection, _ftRow, _cpSection, _cpWindow, _paygSection, _paygRow,
      _bdView, _bdCol, _bdRow, _bdTotal, _doctor, _doctorCheckVm, _doctorCheck,
    );
    expect(_placeholders).toHaveLength(21);
  });
});
