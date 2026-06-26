import { mapTicketStatus } from '../../services/support-service.js';
import { truncateByDisplayWidth, visibleWidth } from '../../ui/textWrap.js';

/**
 * Truncate a title so its terminal display width does not exceed `maxWidth`
 * columns, appending an ellipsis (U+2026) when truncation occurs. Width is
 * measured in terminal columns (CJK fullwidth = 2, ASCII = 1), and the
 * underlying iteration is code-point aware so emoji surrogate pairs are
 * preserved intact.
 */
export function truncateTitle(title: string, maxWidth: number = 36): string {
  if (!title) return '\u2014';
  const normalized = title.replace(/[\r\n]+/g, ' ');
  if (visibleWidth(normalized) <= maxWidth) return normalized;
  return truncateByDisplayWidth(normalized, maxWidth);
}

/**
 * Format a millisecond timestamp to local YYYY-MM-DD HH:mm.
 */
export function formatTicketTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '\u2014';
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format the status display value.
 */
export function formatStatus(rawStatus: string): string {
  return mapTicketStatus(rawStatus);
}

/**
 * Mask an email-shaped identifier, preserving the first character of the local
 * part and the full domain (`a***@domain`). Values without an `@` are returned
 * unchanged. An empty local part degrades to `***@domain`.
 */
export function maskEmail(value: string): string {
  if (!value) return value;
  const at = value.indexOf('@');
  if (at < 0) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local.length > 0 ? local[0] : '';
  return `${head}***@${domain}`;
}
