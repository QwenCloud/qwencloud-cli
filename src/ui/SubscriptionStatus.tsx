import React from 'react';
import { Box, Text } from 'ink';
import { Section } from './Section.js';
import { Table } from './Table.js';
import type { Column } from './Table.js';
import { renderWithInk } from './render.js';
import { colors, theme } from './theme.js';
import { useTerminalSize } from './useTerminalSize.js';
import { TokenPlanDetailTables } from './TokenPlanDetailTables.js';
import { visibleWidth } from './textWrap.js';
import type {
  CodingPlanSectionViewModel,
  CreditPackSectionViewModel,
  OrderStatusColor,
  RecentOrdersSectionViewModel,
  SubscriptionStatusViewModel,
  TokenPlanSectionViewModel,
} from '../view-models/subscription/index.js';

export interface SubscriptionStatusInkProps {
  vm: SubscriptionStatusViewModel;
}

const DIVIDER_CHAR = '─';
const MIN_DIVIDER_WIDTH = 40;

function sectionDivider(title: string, width: number): string {
  const safe = Math.max(MIN_DIVIDER_WIDTH, width);
  const label = ` ${title} `;
  const lead = DIVIDER_CHAR.repeat(3);
  const tail = Math.max(3, safe - lead.length - label.length);
  return `${lead}${label}${DIVIDER_CHAR.repeat(tail)}`;
}

function statusColor(value: string): string | undefined {
  if (value === 'Active') return colors.success;
  if (value === 'Expired') return colors.error;
  return undefined;
}

function LegacyTokenPlanSection({
  section,
  width,
}: {
  section: TokenPlanSectionViewModel;
  width: number;
}) {
  return (
    <Box flexDirection="column">
      <Text color={colors.brand}>{sectionDivider('Token Plan', width)}</Text>
      <Box>
        <Text>Status: </Text>
        <Text color={statusColor(section.status)}>{section.status}</Text>
        <Text>
          {'    '}Auto-Renew: {section.autoRenew}
          {'    '}Expires: {section.expires}
        </Text>
      </Box>
      <Text> </Text>
      {section.tiers.map((tier) => (
        <Box flexDirection="column" key={tier.label}>
          <Text>{tier.label}</Text>
          <Text> {tier.bar}</Text>
        </Box>
      ))}
    </Box>
  );
}

function TeamSeatUsage({ section }: { section: TokenPlanSectionViewModel }) {
  if (section.tiers.length === 0) return null;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>Seat Usage</Text>
      {section.tiers.map((tier) => (
        <Box flexDirection="column" paddingLeft={2} key={tier.label}>
          <Text>{tier.label}</Text>
          <Text>Remaining {tier.bar}</Text>
        </Box>
      ))}
    </Box>
  );
}

function CreditPackSection({
  section,
  width,
}: {
  section: CreditPackSectionViewModel;
  width: number;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text color={colors.brand}>{sectionDivider('Add-on Credit Packs', width)}</Text>
      <Text>
        {section.count} pack{section.count === 1 ? '' : 's'} Total Remaining:{' '}
        {section.totalRemaining}
      </Text>
      <Text> </Text>
      <Text color={colors.muted}>
        {'ID'.padEnd(32)}
        {'Remaining'.padEnd(24)}Expires
      </Text>
      {section.packs.map((pack) => (
        <Box flexDirection="column" key={pack.id}>
          <Text>
            {pack.id.padEnd(32)}
            {pack.remaining.padEnd(24)}Expires: {pack.expires}
          </Text>
          <Text> {pack.bar}</Text>
        </Box>
      ))}
    </Box>
  );
}

function CodingPlanSection({
  section,
  width,
}: {
  section: CodingPlanSectionViewModel;
  width: number;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text color={colors.brand}>{sectionDivider('Coding Plan', width)}</Text>
      <Box>
        <Text>Status: </Text>
        <Text color={statusColor(section.status)}>{section.status}</Text>
        <Text>
          {'    '}Credits: {section.credits}
        </Text>
      </Box>
    </Box>
  );
}

function colorizeOrderStatus(label: string, color: OrderStatusColor): string {
  switch (color) {
    case 'green':
      return theme.success(label);
    case 'orange':
      return theme.warning(label);
    case 'gray':
      return theme.muted(label);
    default:
      return label;
  }
}

const RECENT_ORDERS_COLUMNS: Column[] = [
  { key: 'id', header: 'Order ID' },
  { key: 'typeLabel', header: 'Type' },
  { key: 'date', header: 'Date' },
  { key: 'amount', header: 'Amount' },
  { key: 'status', header: 'Status' },
];

function RecentOrdersSection({
  section,
  width,
  includeCoding,
}: {
  section: RecentOrdersSectionViewModel;
  width: number;
  includeCoding: boolean;
}) {
  const title = `${includeCoding ? 'Recent Orders' : 'Recent Token Plan Orders'} (latest ${section.orders.length})`;
  const data: Record<string, string>[] = section.orders.map((o) => ({
    ...o,
    status: colorizeOrderStatus(o.statusLabel, o.statusColor),
  }));
  // Include Table's dividers and trailing header space when choosing the layout.
  const tableWidth =
    RECENT_ORDERS_COLUMNS.reduce(
      (total, column) =>
        total +
        Math.max(
          visibleWidth(column.header),
          ...data.map((order) => visibleWidth(order[column.key] ?? '')),
        ),
      0,
    ) +
    (RECENT_ORDERS_COLUMNS.length - 1) * 3 +
    1;
  return (
    <Box flexDirection="column" width={width}>
      <Text> </Text>
      <Text color={colors.brand}>{sectionDivider(title, width)}</Text>
      {tableWidth > width ? (
        data.map((order, index) => (
          <Box key={index} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            {RECENT_ORDERS_COLUMNS.map((column) => (
              <Text key={column.key} bold={column.key === 'id'}>
                {column.header}: {order[column.key]}
              </Text>
            ))}
          </Box>
        ))
      ) : (
        <Table columns={RECENT_ORDERS_COLUMNS} data={data} paddingLeft={0} maxTotalWidth={width} />
      )}
    </Box>
  );
}

function FlatFallback({ vm }: { vm: SubscriptionStatusViewModel }) {
  return (
    <>
      {vm.fields.map((f) => (
        <Text key={f.label}>
          {f.label.padEnd(20)}
          {f.value}
        </Text>
      ))}
      {vm.quota && (
        <>
          <Text> </Text>
          <Text>
            {'Quota'.padEnd(20)}
            {vm.quota.display}
          </Text>
          <Text>
            {''.padEnd(20)}
            {vm.quota.bar}
          </Text>
        </>
      )}
    </>
  );
}

export function SubscriptionStatusInk({ vm }: SubscriptionStatusInkProps) {
  const { columns } = useTerminalSize();
  const width = Math.max(1, columns - 4);

  if (vm.banner) {
    return (
      <Section title="Subscription Status" borderStyle="double" maxWidth={columns}>
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={colors.error}>{vm.banner}</Text>
          {vm.diagnostics.map((diagnostic, index) => (
            <Text key={`${diagnostic.api}-${index}`} color={colors.muted}>
              · {diagnostic.errorMessage}
            </Text>
          ))}
        </Box>
      </Section>
    );
  }

  const editionSections = vm.sections.filter((section) => section.id.startsWith('tokenplan-'));
  const hasEditionSections = editionSections.length > 0;

  return (
    <Section
      title="Subscription Status"
      borderStyle="double"
      footer={vm.footnote ?? undefined}
      maxWidth={columns}
    >
      <Box flexDirection="column" paddingLeft={2}>
        {hasEditionSections ? (
          <>
            <Text color={colors.brand}>{sectionDivider('Token Plans', width)}</Text>
            {editionSections.map((section, index) => (
              <Box
                key={section.id}
                flexDirection="column"
                paddingLeft={2}
                marginTop={index === 0 ? 0 : 1}
              >
                <Text bold>{section.title}</Text>
                <Box flexDirection="column" paddingLeft={2}>
                  {section.fields.map((field) => (
                    <Text key={field.label}>
                      {field.label.padEnd(18)}
                      {field.value}
                    </Text>
                  ))}
                  <TokenPlanDetailTables
                    tables={section.detailTables ?? []}
                    paddingLeft={0}
                    maxTotalWidth={Math.max(1, columns - 8)}
                    recordTitleGap={section.id === 'tokenplan-individual' ? 0 : 1}
                  />
                </Box>
                {section.id === 'tokenplan-team' &&
                  vm.tokenPlanSection &&
                  !section.detailTables?.length && <TeamSeatUsage section={vm.tokenPlanSection} />}
              </Box>
            ))}
          </>
        ) : vm.tokenPlanSection ? (
          <LegacyTokenPlanSection section={vm.tokenPlanSection} width={width} />
        ) : vm.codingPlanSection ? null : (
          <FlatFallback vm={vm} />
        )}
        {vm.creditPackSection && <CreditPackSection section={vm.creditPackSection} width={width} />}
        {vm.codingPlanSection && <CodingPlanSection section={vm.codingPlanSection} width={width} />}
        {vm.recentOrdersSection && (
          <RecentOrdersSection
            section={vm.recentOrdersSection}
            width={width}
            includeCoding={vm.codingPlanSection !== null}
          />
        )}
      </Box>
    </Section>
  );
}

export async function renderSubscriptionStatusInk(vm: SubscriptionStatusViewModel): Promise<void> {
  await renderWithInk(<SubscriptionStatusInk vm={vm} />);
}
