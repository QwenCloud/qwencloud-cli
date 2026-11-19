import React from 'react';
import { Box, Text } from 'ink';
import { Section } from './Section.js';
import { renderWithInk } from './render.js';
import { colors } from './theme.js';
import { TokenPlanDetailTables } from './TokenPlanDetailTables.js';
import { TokenPlanSeatDetails } from './TokenPlanSeatDetails.js';
import { useTerminalSize } from './useTerminalSize.js';
import type { TokenPlanStatusViewModel as BaseTokenPlanStatusViewModel } from '../types/tokenplan-subscription.js';
import type { TokenPlanStatusViewModel } from '../view-models/subscription/tokenplan-status.js';

export interface SubscriptionTokenPlanStatusInkProps {
  vm: BaseTokenPlanStatusViewModel | TokenPlanStatusViewModel;
}

export function SubscriptionTokenPlanStatusInk({ vm }: SubscriptionTokenPlanStatusInkProps) {
  const { columns } = useTerminalSize();
  const sections = vm.editionSections ?? [];
  const width = Math.max(1, columns - 4);
  const seatLines = vm.seatLines ?? vm.table?.rows ?? [];
  const totalLine = vm.totalLine ?? vm.footer?.total ?? vm.table?.totalRow;
  const legacyRows = [...seatLines, ...(totalLine ? [totalLine] : [])];
  return (
    <Section title="TOKEN PLAN STATUS" footer={vm.footnote ?? undefined} maxWidth={columns}>
      <Box flexDirection="column" width={Math.max(1, columns - 2)}>
        {sections.map((section, index) => (
          <Box key={section.edition} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text bold>{section.title}</Text>
            <Box flexDirection="column" paddingLeft={2}>
              {section.fields.map((field) => (
                <Text key={field.label}>
                  {field.label.padEnd(18)}
                  {field.value}
                </Text>
              ))}
              <TokenPlanDetailTables
                tables={
                  'detailTables' in section && Array.isArray(section.detailTables)
                    ? section.detailTables
                    : []
                }
                paddingLeft={0}
                maxTotalWidth={width}
                recordTitleGap={0}
              />
            </Box>
          </Box>
        ))}
        {sections.length === 0 && (vm.header || legacyRows.length > 0 || vm.seatDetails) && (
          <Box flexDirection="column" paddingLeft={2}>
            {vm.header && (
              <>
                <Text>
                  {'Product'.padEnd(16)}
                  {vm.header.product}
                </Text>
                <Text>
                  {'End At'.padEnd(16)}
                  {vm.header.period}
                </Text>
                <Text>
                  {'Auto-Renew'.padEnd(16)}
                  {vm.header.autoRenew}
                </Text>
                <Text>
                  {'Renewable'.padEnd(16)}
                  {vm.header.renewable}
                </Text>
              </>
            )}
            {legacyRows.length > 0 && (
              <TokenPlanDetailTables
                tables={[
                  {
                    title: 'SEAT SUMMARY',
                    headers: [
                      'Seat Type',
                      'Seats',
                      'Total Credits',
                      'Remaining Credits',
                      'Reset At',
                    ],
                    rows: legacyRows.map((row) => [
                      row.specType,
                      row.seats,
                      row.totalValue,
                      row.surplusValue,
                      row.nextCycleFlushTime,
                    ]),
                    emptyMessage: 'No seats available.',
                    layout: 'records',
                  },
                ]}
                paddingLeft={0}
                maxTotalWidth={width}
                recordTitleGap={0}
              />
            )}
            {vm.seatDetails && <TokenPlanSeatDetails details={vm.seatDetails} />}
          </Box>
        )}
        {vm.warnings && vm.warnings.length > 0 && (
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            {vm.warnings.map((warning, index) => (
              <Text key={index} color={colors.warning}>
                {warning}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Section>
  );
}

export async function renderSubscriptionTokenPlanStatusInk(
  vm: BaseTokenPlanStatusViewModel | TokenPlanStatusViewModel,
): Promise<void> {
  await renderWithInk(<SubscriptionTokenPlanStatusInk vm={vm} />);
}
