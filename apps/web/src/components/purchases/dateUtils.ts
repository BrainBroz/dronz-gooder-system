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
