// PD-08: janela "quinta-feira de manhã" = 08:00–12:00 no fuso IANA da posição de origem (alerta, nunca bloqueio).
export const THURSDAY_MORNING = { inicio: 8, fim: 12 } as const;

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short"
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday")
  };
}

// Instante UTC de uma hora local; duas passagens acertam o deslocamento também em troca de horário.
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string
) {
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    guess += target - asUtc;
  }
  return new Date(guess);
}

// Para uma partida planejada: se cai numa quinta no fuso da origem, devolve o início e o fim da janela.
export function thursdayMorningWindow(partidaEm: Date, timeZone: string) {
  const local = zonedParts(partidaEm, timeZone);
  if (local.weekday !== "Thu") return null;
  return {
    inicio: zonedTimeToUtc(
      local.year,
      local.month,
      local.day,
      THURSDAY_MORNING.inicio,
      timeZone
    ),
    fim: zonedTimeToUtc(
      local.year,
      local.month,
      local.day,
      THURSDAY_MORNING.fim,
      timeZone
    )
  };
}
