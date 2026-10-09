export const COMMUNICATION_TIME_ZONE = "America/Mexico_City";

export type CommunicationHours = {
  enabled: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
};

export const DEFAULT_COMMUNICATION_HOURS: CommunicationHours = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "17:00",
};

export function isWithinCommunicationHours(settings: CommunicationHours, now: Date) {
  if (!settings.enabled) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMMUNICATION_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const day = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[values.weekday];
  const minuteOfDay = Number(values.hour) * 60 + Number(values.minute);
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return settings.weekdays.includes(day) && minuteOfDay >= start && minuteOfDay < end;
}
