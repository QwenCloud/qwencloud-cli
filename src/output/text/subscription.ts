import type {
  SubscriptionStatusViewModel,
  SubscriptionOrdersViewModel,
} from '../../view-models/subscription/index.js';
import { formatTextTable } from '../format.js';

function divider(title: string): string {
  return `=== ${title} ===`;
}

export function renderTextSubscriptionStatus(vm: SubscriptionStatusViewModel): void {
  if (vm.banner) {
    console.log(`  ${vm.banner}`);
    if (vm.diagnostics.length > 0) {
      console.log('');
      console.log('  Diagnostics:');
      for (const d of vm.diagnostics) {
        console.log(`    - ${d.api}: ${d.errorCode} ${d.errorMessage}`);
      }
    }
    return;
  }

  const hasNewSections =
    vm.tokenPlanSection !== null ||
    vm.creditPackSection !== null ||
    vm.codingPlanSection !== null ||
    vm.recentOrdersSection !== null;

  if (!hasNewSections) {
    for (const f of vm.fields) {
      console.log(`  ${f.label.padEnd(18)}${f.value}`);
    }

    if (vm.quota) {
      console.log('');
      console.log(`  ${'Quota'.padEnd(18)}${vm.quota.display}`);
      console.log(`  ${''.padEnd(18)}${vm.quota.bar}`);
    }

    if (vm.footnote) {
      console.log('');
      console.log(`  ${vm.footnote}`);
    }
    return;
  }

  if (vm.tokenPlanSection) {
    const s = vm.tokenPlanSection;
    console.log(`  ${divider('Token Plan')}`);
    console.log(`  Status: ${s.status}    Auto-Renew: ${s.autoRenew}    Expires: ${s.expires}`);
    console.log('');
    s.tiers.forEach((tier, idx) => {
      console.log(`  ${tier.label}:`);
      console.log(`    ${tier.bar}`);
      if (idx < s.tiers.length - 1) console.log('');
    });
  }

  if (vm.creditPackSection) {
    const s = vm.creditPackSection;
    console.log('');
    console.log(`  ${divider('Credit Pack')}`);
    console.log(
      `  ${s.count} pack${s.count === 1 ? '' : 's'}    Total Remaining: ${s.totalRemaining}`,
    );
    console.log('');
    console.log(`  ${'ID'.padEnd(16)}${'Remaining'.padEnd(24)}Expires`);
    for (const pack of s.packs) {
      console.log(`  ${pack.id.padEnd(16)}${pack.remaining.padEnd(24)}Expires: ${pack.expires}`);
    }
  }

  if (vm.codingPlanSection) {
    const s = vm.codingPlanSection;
    console.log('');
    console.log(`  ${divider('Coding Plan')}`);
    console.log(`  Status: ${s.status}    Credits: ${s.credits}`);
  }

  if (vm.recentOrdersSection) {
    const s = vm.recentOrdersSection;
    console.log('');
    console.log(`  ${divider(`Recent Orders (latest ${s.orders.length})`)}`);
    console.log(`  ${'Order ID'.padEnd(16)}${'Type'.padEnd(10)}${'Date'.padEnd(13)}Amount`);
    for (const order of s.orders) {
      console.log(
        `  ${order.id.padEnd(16)}${order.typeLabel.padEnd(10)}${order.date.padEnd(13)}${order.amount}`,
      );
    }
  }

  if (vm.footnote) {
    console.log('');
    console.log(`  ${vm.footnote}`);
  }
}

export function renderTextSubscriptionOrders(vm: SubscriptionOrdersViewModel): void {
  if (vm.isEmpty) {
    console.log(`  ${vm.emptyPlaceholder}`);
    return;
  }

  const headers = vm.columns.map((c) => c.header);
  const rows = vm.items.map((r) => [
    r.orderId,
    r.orderTypeLabel,
    r.orderTime,
    r.amountDisplay,
    r.detailError ? `${r.statusLabel} (detail err)` : r.statusLabel,
  ]);
  console.log(formatTextTable(headers, rows));
  console.log(`  ${vm.pagingNote}`);
  if (vm.diagnostics.length > 0) {
    console.log(`  ${vm.diagnostics.length} detail call(s) failed`);
  }
}
