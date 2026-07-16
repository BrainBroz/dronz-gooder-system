/** Formatação de idade puramente informativa/derivada — não é regra de negócio. */
export function formatAge(isoDate: string | null): string {
  if (!isoDate) return "—";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "agora";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
