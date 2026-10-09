export const CALENDAR_KIND_VALUES = ["evento", "reunion", "festival", "entrega", "suspension", "clase", "otro"] as const;
export type CalendarKind = typeof CALENDAR_KIND_VALUES[number];
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  evento: "Eventos escolares", reunion: "Reuniones de familias", festival: "Festivales",
  entrega: "Fechas de entrega", suspension: "Suspensiones de clases", clase: "Clases virtuales", otro: "Otros",
};

export type CalendarFilters = { groupId?: string; kind?: CalendarKind };

/** Filters are sent to the server before its limit; never hide a truncated feed locally. */
export function calendarFeedUrl(from: string, to: string, filters: CalendarFilters = {}) {
  const params = new URLSearchParams({ from, to });
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (filters.kind) params.set("kind", filters.kind);
  return `/api/calendar?${params}`;
}
