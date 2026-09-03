// Safe date formatting.
//
// Every date in this app comes from persisted JSON — AsyncStorage records
// written by older schema versions, NOAA payloads, Supabase rows, restored
// backups. Any of those can hand us undefined, '', or a malformed string,
// and `new Date(bad).toLocaleString()` renders the literal text
// "Invalid Date". Shipping that to a roofer looks broken; shipping it into
// a HAAG claim packet or a customer proposal is worse — those are the
// documents the whole product's credibility rests on.
//
// These helpers never throw and never render "Invalid Date".

const INVALID = 'Invalid Date';

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the value parses to a real date. */
export function isValidDate(value: string | number | Date | null | undefined): boolean {
  return parse(value) !== null;
}

/** e.g. "August 1, 2026". Returns `fallback` for anything unparseable. */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parse(value);
  if (!d) return fallback;
  const out = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return out === INVALID ? fallback : out;
}

/** e.g. "8/1/2026". Compact form for dense rows and tables. */
export function formatDateShort(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parse(value);
  if (!d) return fallback;
  const out = d.toLocaleDateString();
  return out === INVALID ? fallback : out;
}

/** e.g. "August 1, 2026 at 4:08 PM". */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parse(value);
  if (!d) return fallback;
  const out = d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  return out === INVALID ? fallback : out;
}

/** e.g. "just now", "12m ago", "3h ago", "2d ago". */
export function formatRelative(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parse(value);
  if (!d) return fallback;
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 0) return formatDateShort(d, fallback);   // future-dated
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateShort(d, fallback);
}
