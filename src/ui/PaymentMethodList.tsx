import React from 'react';
import { Box } from 'ink';
import { Section } from './Section.js';
import { Table } from './Table.js';
import { renderWithInk } from './render.js';
import type { PaymentMethodListViewModel } from '../view-models/billing/payment-method.js';

const COLUMNS = [
  { key: 'type', header: 'Type' },
  { key: 'number', header: 'Number' },
  { key: 'status', header: 'Status' },
];

export function PaymentMethodListInk({ vm }: { vm: PaymentMethodListViewModel }) {
  const data = vm.rows.map((r) => ({
    type: r.type,
    number: r.number,
    status: r.status,
  }));

  const footer = `Total: ${vm.rows.length}`;

  return (
    <Section title="Payment Methods" footer={footer}>
      <Box flexDirection="column">
        <Table columns={COLUMNS} data={data} paddingLeft={0} />
      </Box>
    </Section>
  );
}

export async function renderPaymentMethodListInk(vm: PaymentMethodListViewModel): Promise<void> {
  await renderWithInk(<PaymentMethodListInk vm={vm} />);
}
