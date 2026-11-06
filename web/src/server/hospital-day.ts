/** UTC instants bounding the calendar day `day` (YYYY-MM-DD) in `timezone`: [start, start of the next day). */
export function hospitalDayBounds(day: string, timezone: string): [Date, Date] {
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offsetAt = (at: Date) => {
    const part = (type: string) => Number(zone.formatToParts(at).find((p) => p.type === type)!.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - at.getTime();
  };
  const startOf = (date: string) => {
    const wall = new Date(`${date}T00:00:00Z`);
    // Two passes settle the offset across a daylight-saving change.
    return new Date(wall.getTime() - offsetAt(new Date(wall.getTime() - offsetAt(wall))));
  };
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [startOf(day), startOf(next.toISOString().slice(0, 10))];
}
