export const SCHOOL_TIME_ZONE = "America/Mexico_City";

export function schoolDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function schoolDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: SCHOOL_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(value instanceof Date ? value : new Date(value));
}

export function schoolDateTimeInput(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value instanceof Date ? value : new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function schoolLocalInputToISO(value: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) throw new Error("Indica una fecha y una hora.");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find(item => item.type === type)?.value ?? 0);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const next = guess + desired - represented;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}
