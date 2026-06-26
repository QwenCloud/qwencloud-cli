/**
 * View-model unit tests for the support rate result.
 *
 * The view model transforms a raw rating submission (ticketId + rating +
 * optional comment) into a display-ready structure that powers the TUI
 * success panel, the TEXT formatter, and the JSON output.
 *
 * Covers:
 *   - Field mapping for happy path (rating + comment)
 *   - Comment handling when omitted (null/undefined contract)
 *   - Rating-level → label mapping (1, 5)
 *   - Rating-level → star visual mapping (4 → ★★★★☆)
 *   - JSON contract completeness (all fields per scope §ViewModel Field Contract)
 */
import { describe, it, expect } from 'vitest';
import { buildSupportRateViewModel } from '../../../src/view-models/support/index.js';

describe('buildSupportRateViewModel — happy path', () => {
  it('maps ticketId, rating and comment into the view-model', () => {
    const vm = buildSupportRateViewModel('TICKET-130000001', 4, 'Good response');
    expect(vm.ticketId).toBe('TICKET-130000001');
    expect(vm.rating).toBe(4);
    expect(vm.comment).toBe('Good response');
    expect(vm.status).toBe('score');
    expect(vm.statusLabel).toBe('Closed');
  });
});

describe('buildSupportRateViewModel — optional comment', () => {
  it('renders comment as null/undefined when not supplied', () => {
    const vm = buildSupportRateViewModel('TICKET-130000001', 3);
    // Contract: comment is "string | null" in JSON output and may be undefined
    // in the in-memory view-model. Either falsy form is acceptable.
    expect(vm.comment === null || vm.comment === undefined).toBe(true);
  });
});

describe('buildSupportRateViewModel — rating label mapping', () => {
  it.each<[number, string]>([
    [1, 'Very unsatisfied'],
    [2, 'Unsatisfied'],
    [3, 'Neutral'],
    [4, 'Satisfied'],
    [5, 'Very satisfied'],
  ])('rating=%i maps to label "%s"', (rating, label) => {
    const vm = buildSupportRateViewModel('TICKET-130000001', rating);
    expect(vm.ratingLabel).toBe(label);
  });
});

describe('buildSupportRateViewModel — star visual mapping', () => {
  it.each<[number, string]>([
    [1, '★☆☆☆☆'],
    [4, '★★★★☆'],
    [5, '★★★★★'],
  ])('rating=%i renders visual "%s"', (rating, visual) => {
    const vm = buildSupportRateViewModel('TICKET-130000001', rating);
    expect(vm.ratingVisual).toBe(visual);
  });
});

describe('buildSupportRateViewModel — JSON contract completeness', () => {
  it('exposes every field required by the JSON output contract', () => {
    const vm = buildSupportRateViewModel('TICKET-130000001', 5, 'Excellent');
    // Per scope §ViewModel Field Contract — JSON Output keys:
    //   ticketId, rating, ratingLabel, comment, status, statusLabel, timestamp.
    expect(vm.ticketId).toBe('TICKET-130000001');
    expect(vm.rating).toBe(5);
    expect(vm.ratingLabel).toBe('Very satisfied');
    expect(vm.comment).toBe('Excellent');
    expect(vm.status).toBe('score');
    expect(vm.statusLabel).toBe('Closed');
    expect(typeof vm.timestamp).toBe('string');
    expect(vm.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
