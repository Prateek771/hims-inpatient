/** Wall-time presentation only. Persisted records remain exact UTC instants. */
export function hospitalLocalInput(value: Date | string, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}

export function hospitalLocalInstant(value: string, timezone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!m) throw new RangeError("Enter a valid hospital date and time");
  const [, y, month, day, h, min, sec = "00", fraction = ""] = m;
  const ms = fraction.padEnd(3, "0"), canonical = `${y}-${month}-${day}T${h}:${min}:${sec}.${ms}`;
  const wall = new Date(`${canonical}Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 23) !== canonical)
    throw new RangeError("Enter a valid hospital date and time");
  // Sample both sides of all IANA offset transitions around this wall date,
  // then verify candidates by an exact round trip. No browser timezone is used.
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour++) {
    const instant = new Date(wall.getTime() + hour * 3600000);
    offsets.add(Date.parse(`${hospitalLocalInput(instant, timezone)}Z`) - instant.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(wall.getTime() - offset))
    .filter(instant => hospitalLocalInput(instant, timezone) === canonical);
  if (candidates.length !== 1)
    throw new RangeError(candidates.length ? "This hospital time occurs twice during a clock change. Use an unambiguous time or the hospital's existing review process." : "This hospital time does not exist during a clock change.");
  return candidates[0].toISOString();
}

export function formatHospitalTime(value: Date | string, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "medium", hourCycle: "h23" }).format(date) + ` · ${timezone}`;
}
