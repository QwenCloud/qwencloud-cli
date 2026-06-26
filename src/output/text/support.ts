import type { SupportListViewModel } from '../../view-models/support/list.js';
import type { SupportViewViewModel } from '../../view-models/support/view.js';
import { formatTextTable } from '../format.js';

export function renderTextSupportList(vm: SupportListViewModel): void {
  if (vm.isEmpty) {
    console.log(`  ${vm.emptyMessage}`);
    return;
  }

  const headers = ['TICKET ID', 'TITLE', 'STATUS', 'CREATED'];
  const rows = vm.items.map((t) => [t.id, t.title, t.status, t.createdAt]);
  console.log(formatTextTable(headers, rows));

  const totalPages = vm.totalPages;
  console.log(`  ${vm.total} tickets  \u00b7  Page ${vm.page} of ${totalPages}`);
}

export function renderTextSupportView(vm: SupportViewViewModel): void {
  console.log(`  Ticket: ${vm.ticket.id}`);
  console.log(`  Title:  ${vm.ticket.title}`);
  console.log(`  Status: ${vm.ticket.status}`);
  console.log(`  Category: ${vm.ticket.category}`);
  console.log(`  Created: ${vm.ticket.createdAt}`);
  console.log('');
  console.log('  Description:');
  console.log(`    ${vm.ticket.description}`);
  console.log('');

  if (vm.messages.length > 0) {
    console.log('  Messages:');
    console.log('  ' + '\u2500'.repeat(60));
    for (const msg of vm.messages) {
      const name = msg.nickName ? `${msg.displayRole} (${msg.nickName})` : msg.displayRole;
      console.log(`  [${msg.createdAt}] ${name}:`);
      const lines = msg.content.split('\n');
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      console.log('');
    }
  }

  if (vm.truncated) {
    console.log('  Showing latest 100 messages. Older messages truncated.');
  }
}
