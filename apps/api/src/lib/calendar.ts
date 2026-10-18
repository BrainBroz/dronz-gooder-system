// Converte um início de dia do calendário operacional para UTC sem depender do fuso do servidor.
export function zonedDayStart(
  year: number,
  month: number,
  day: number,
  timeZone: string
) {
  const calendar = Date.UTC(year, month - 1, day);
  let instant = calendar;
  let previous = Number.NaN;
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value])
    );
    const offset =
      Date.UTC(
        +parts.year!,
        +parts.month! - 1,
        +parts.day!,
        +parts.hour!,
        +parts.minute!,
        +parts.second!
      ) - instant;
    const next = calendar - offset;
    if (next === instant) break;
    // Se o horário de verão saltou a meia-noite, usar o primeiro instante existente desse dia.
    if (next === previous) return new Date(Math.max(instant, next));
    previous = instant;
    instant = next;
  }
  return new Date(instant);
}
