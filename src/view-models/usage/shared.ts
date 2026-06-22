import { site } from '../../site.js';

/** Currency symbol resolved from site config — shared by usage summary / breakdown sections. */
export const CUR = site.features.currency === 'USD' ? '$' : ' ';
