import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, groups, tasks } from "@/db/schema";
import { accessibleGroupIds, type Actor } from "@/lib/access";
import { schoolLocalInputToISO } from "@/lib/datetime";
import type { CalendarFilters } from "@/lib/calendar-filters";

export type CalendarRange = { from: string; to: string };

export async function calendarFeed(actor: Actor, range: CalendarRange, filters: CalendarFilters = {}) {
  const from = new Date(schoolLocalInputToISO(`${range.from}T00:00`));
  const dayAfterTo = new Date(`${range.to}T12:00:00Z`);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);
  const toExclusive = new Date(schoolLocalInputToISO(`${dayAfterTo.toISOString().slice(0, 10)}T00:00`));
  const groupIds = await accessibleGroupIds(actor);
  const groupAccess = groupIds.length ? or(isNull(calendarEvents.groupId), inArray(calendarEvents.groupId, groupIds)) : isNull(calendarEvents.groupId);
  const db = getDb();

  const events = await db.select({ id: calendarEvents.id, groupId: calendarEvents.groupId, groupName: groups.name, kind: calendarEvents.kind, title: calendarEvents.title, description: calendarEvents.description, startsAt: calendarEvents.startsAt, endsAt: calendarEvents.endsAt })
    .from(calendarEvents).leftJoin(groups, eq(groups.id, calendarEvents.groupId))
    .where(and(gte(calendarEvents.startsAt, from), lt(calendarEvents.startsAt, toExclusive), groupAccess,
      filters.groupId === "general" ? isNull(calendarEvents.groupId) : filters.groupId ? eq(calendarEvents.groupId, filters.groupId) : undefined,
      filters.kind ? eq(calendarEvents.kind, filters.kind) : undefined))
    .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id)).limit(501);

  const dueTasks = groupIds.length && filters.groupId !== "general" && (!filters.kind || filters.kind === "entrega") ? await db.select({ id: tasks.id, groupId: tasks.groupId, groupName: groups.name, title: tasks.title, dueAt: tasks.dueAt })
    .from(tasks).innerJoin(groups, eq(groups.id, tasks.groupId))
    .where(and(inArray(tasks.groupId, groupIds), eq(groups.active, true), isNull(tasks.archivedAt), gte(tasks.dueAt, from), lt(tasks.dueAt, toExclusive), filters.groupId ? eq(tasks.groupId, filters.groupId) : undefined))
    .orderBy(asc(tasks.dueAt), asc(tasks.id)).limit(501) : [];

  const items = [
    ...events.map(event => ({ ...event, source: "evento" as const, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt?.toISOString() ?? null })),
    ...dueTasks.flatMap(task => task.dueAt ? [{ id: `task:${task.id}`, groupId: task.groupId, groupName: task.groupName, kind: "entrega", title: task.title, description: null, startsAt: task.dueAt.toISOString(), endsAt: null, source: "tarea" as const }] : []),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));

  return { items: items.slice(0, 500), timeZone: "America/Mexico_City", limited: items.length > 500 };
}
