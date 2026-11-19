import { stripVTControlCharacters } from 'node:util';
import type { TokenPlanListSection } from '../../types/tokenplan-catalog.js';
import type { TokenPlanSupportedModel } from '../../types/tokenplan-benefits.js';
import type { TokenPlanStatusResult } from '../../types/tokenplan-subscription.js';
import { formatCmd } from '../../utils/runtime-mode.js';
import { sortTokenPlanSeats } from './tokenplan-seat-details.js';

export interface TokenPlanDisplayTable {
  title: string;
  headers: string[];
  rows: string[][];
  emptyMessage: string;
  layout?: 'matrix' | 'records';
  edition?: 'individual' | 'team';
  note?: string;
}

const CAPABILITY_LABELS = new Map<string, string>([
  ['TG', 'Text Generation'],
  ['ASR', 'Speech Recognition'],
  ['TTS', 'Text-to-Speech'],
  ['IU', 'Image Understanding'],
  ['VU', 'Visual Understanding'],
  ['IG', 'Image Generation'],
  ['VG', 'Video Generation'],
  ['IP', 'Image Processing'],
  ['TR', 'Embedding'],
  ['ME', 'Multimodal Embedding'],
  ['RK', 'Reranking'],
  ['AU', 'Audio Understanding'],
  ['OMNI', 'Omni'],
  ['Reasoning', 'Reasoning Model'],
  ['QwQ', 'Reasoning Model'],
  ['Realtime-Text-to-Speech', 'Real-Time Speech Synthesis'],
  ['Realtime-Omni', 'Realtime Omni'],
  ['Realtime-Voice-Replication', 'Realtime Voice Replication'],
  ['Multimodal-Omni', 'Omni'],
  ['Realtime-ASR', 'Realtime ASR'],
  ['Realtime-Audio-Translate', 'Realtime Audio Translate'],
  ['Realtime-Chatting', 'Realtime Chatting'],
]);

function modelCapabilityText(capabilities: readonly string[]): string {
  return [
    ...new Set(
      capabilities
        .filter(Boolean)
        .map((capability) => CAPABILITY_LABELS.get(capability) ?? capability),
    ),
  ].join(', ');
}

function modelTagText(model: TokenPlanSupportedModel): string | null {
  const tags = [
    ...(model.isNew === true ? ['New'] : []),
    ...(model.badgeLabel ? [model.badgeLabel] : []),
  ];
  return tags.length > 0 ? tags.join(', ') : null;
}

export function tokenPlanDisplayText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Array.from(stripVTControlCharacters(String(value)))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('');
}

export function tokenPlanDisplayDate(value: string | null | undefined): string {
  return value && Number.isFinite(Date.parse(value))
    ? `${new Date(value)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '')} (UTC)`
    : '—';
}

export function tokenPlanWindowLabel(value: string): string {
  return (
    ({ five_hour: 'Five Hours', weekly: 'Weekly', monthly: 'Monthly' } as Record<string, string>)[
      value
    ] ?? tokenPlanDisplayText(value)
  );
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value * 100) / 100}%`;
}

export function buildTokenPlanCatalogDetails(
  section: TokenPlanListSection,
): TokenPlanDisplayTable[] {
  const plan = section.plans?.[0];
  if (!plan || plan.supportedModels === undefined) return [];
  return [
    {
      title: 'SUPPORTED MODELS',
      layout: 'records',
      headers: ['MODEL BRAND', 'MODEL NAME', 'CAPABILITIES', 'TAG'],
      rows: (plan.supportedModels ?? []).map((model) =>
        [
          model.modelBrand,
          model.modelId,
          modelCapabilityText(model.capabilities),
          modelTagText(model),
        ].map(tokenPlanDisplayText),
      ),
      emptyMessage:
        plan.supportedModels === null
          ? 'Supported model information unavailable. Please try again later.'
          : 'No supported models available.',
    },
  ];
}

export function buildTokenPlanStatusDetails(
  result: Pick<TokenPlanStatusResult, 'individual' | 'team'>,
): TokenPlanDisplayTable[] {
  const tables: TokenPlanDisplayTable[] = [];
  const individual = result.individual;
  if (individual?.status !== 'not_subscribed' && individual?.tiers) {
    tables.push({
      title: 'INDIVIDUAL CREDIT WINDOWS',
      edition: 'individual',
      layout: 'records',
      headers: ['TIER', 'WINDOW', 'USED (%)', 'REMAINING (%)', 'RESET AT'],
      rows: individual.tiers.map((tier) => [
        tokenPlanDisplayText(tier.tier),
        tier.windowType,
        percent(tier.usedPct),
        percent(tier.remainingPct),
        tokenPlanDisplayDate(tier.resetAt),
      ]),
      emptyMessage: 'No confirmed credit window available.',
    });
  }
  if (result.team?.status !== 'not_subscribed' && result.team?.seatSummaries) {
    const showRemainingCredits = result.team.seatSummaries.some(
      (seat) => seat.remainingCredits != null,
    );
    tables.push({
      title: 'TEAM CREDIT SUMMARY',
      edition: 'team',
      layout: 'records',
      headers: [
        'SEAT TYPE',
        'SEAT COUNT',
        'TOTAL CREDITS',
        ...(showRemainingCredits ? ['REMAINING CREDITS'] : []),
        'REMAINING (%)',
        'RESET AT',
      ],
      rows: sortTokenPlanSeats(result.team.seatSummaries, (seat) => seat.seatType).map((seat) => [
        tokenPlanDisplayText(seat.seatType),
        tokenPlanDisplayText(seat.seatCount),
        tokenPlanDisplayText(seat.totalCredits),
        ...(showRemainingCredits ? [tokenPlanDisplayText(seat.remainingCredits)] : []),
        percent(seat.remainingPct),
        tokenPlanDisplayDate(seat.resetAt),
      ]),
      emptyMessage: 'No confirmed team credit summary available.',
      note: [
        'The total credits is the sum of the credits of all seats of the same seat type.',
        'Only active seats are shown.',
        `Run ${formatCmd('subscription tokenplan seats')} for per-seat member and quota details.`,
      ].join('\n'),
    });
  }
  return tables;
}
