/** Returns today's date in the local calendar as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0,10)` uses UTC and can produce the wrong
 * day for users in UTC-3 (São Paulo) between 21:00–23:59, or on a month
 * boundary the wrong month entirely.
 */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function utcNoonFromLocalDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.toISOString();
}
