import { describe, expect, it } from 'vitest';
import { site } from '../src/site.js';

describe('international site configuration', () => {
  it('exposes the regional production endpoint for CS-Data', () => {
    expect(site.csDataEndpoint).toBe('https://ap-southeast-1-cs-data.qwencloud.com');
  });

  it('separates the solo purchase commodity from the legacy personal commodity', () => {
    expect(site.features.tokenPlanCommodityCodes.soloBuy).toBe('sfm_tokenplansolo_public_intl');
    expect(site.features.tokenPlanCommodityCodes.personal).toBe('sfm_tokenplanpersonal_dp_intl');
    expect(site.features.tokenPlanCommodityCodes.soloBuy).not.toBe(
      site.features.tokenPlanCommodityCodes.personal,
    );
  });

  it('preserves the team, addon, Coding Plan, and currency settings', () => {
    expect(site.features.tokenPlanCommodityCodes.teams).toBe('sfm_tokenplanteams_dp_intl');
    expect(site.features.tokenPlanCommodityCodes.addon).toBe('sfm_tokenplanteamsaddon_dp_intl');
    expect(site.features.codingPlanCommodityCode).toBe('sfm_codingplan_public_intl');
    expect(site.features.currency).toBe('USD');
  });
});
