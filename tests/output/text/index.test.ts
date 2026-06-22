import { describe, it, expect } from 'vitest';
import * as textExports from '../../../src/output/text/index.js';

describe('output/text/index re-exports', () => {
  it('exports renderTextWorkspaceList', () => {
    expect(textExports.renderTextWorkspaceList).toBeTypeOf('function');
  });

  it('exports renderTextWorkspaceLimit', () => {
    expect(textExports.renderTextWorkspaceLimit).toBeTypeOf('function');
  });


  it('exports renderTextBillingLimit', () => {
    expect(textExports.renderTextBillingLimit).toBeTypeOf('function');
  });

  it('exports renderTextBillingBreakdown', () => {
    expect(textExports.renderTextBillingBreakdown).toBeTypeOf('function');
  });

  it('exports renderTextBillingSummary', () => {
    expect(textExports.renderTextBillingSummary).toBeTypeOf('function');
  });

  it('exports renderTextSubscriptionStatus', () => {
    expect(textExports.renderTextSubscriptionStatus).toBeTypeOf('function');
  });

  it('exports renderTextSubscriptionOrders', () => {
    expect(textExports.renderTextSubscriptionOrders).toBeTypeOf('function');
  });

  it('exports renderTextUsageSummary', () => {
    expect(textExports.renderTextUsageSummary).toBeTypeOf('function');
  });

  it('exports renderTextUsageBreakdown', () => {
    expect(textExports.renderTextUsageBreakdown).toBeTypeOf('function');
  });

  it('exports renderTextUsageLogs', () => {
    expect(textExports.renderTextUsageLogs).toBeTypeOf('function');
  });


  it('exports renderTextDocsSearch', () => {
    expect(textExports.renderTextDocsSearch).toBeTypeOf('function');
  });

  it('exports renderTextModelsList', () => {
    expect(textExports.renderTextModelsList).toBeTypeOf('function');
  });

  it('exports renderTextModelDetail', () => {
    expect(textExports.renderTextModelDetail).toBeTypeOf('function');
  });

  it('exports renderTextDoctor', () => {
    expect(textExports.renderTextDoctor).toBeTypeOf('function');
  });
});
