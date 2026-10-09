import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { enrollments, guardians, notifications, studentGuardians, students, user, userRoles } from "@/db/schema";

type Notice = { kind: string; title: string; href: string; sourceId: string; createdAt: Date };

export async function notifyUsers(userIds: string[], notice: Notice) {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return 0;
  const db = getDb();
  await Promise.all(uniqueIds.map(userId => db.insert(notifications).values({
    id: crypto.randomUUID(), userId, kind: notice.kind, title: notice.title, href: notice.href,
    dedupeKey: `${notice.kind}:${notice.sourceId}:${userId}`, createdAt: notice.createdAt,
  }).onConflictDoNothing()));
  return uniqueIds.length;
}

export async function notifyGroupFamilies(groupId: string, notice: Notice) {
  const recipients = await getDb().selectDistinct({ id: user.id })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .innerJoin(user, eq(user.id, guardians.userId))
    .where(and(
      eq(enrollments.groupId, groupId), isNull(enrollments.endedAt), eq(students.active, true),
      eq(studentGuardians.active, true), eq(guardians.active, true), eq(user.active, true),
    ));
  return notifyUsers(recipients.map(row => row.id), notice);
}

export async function notifyAllFamilies(notice: Notice) {
  const recipients = await getDb().selectDistinct({ id: user.id })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(and(eq(userRoles.role, "tutor"), eq(user.active, true)));
  return notifyUsers(recipients.map(row => row.id), notice);
}

export async function notifyStudentFamilies(studentId: string, notice: Notice) {
  const recipients = await getDb().selectDistinct({ id: user.id })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .innerJoin(user, eq(user.id, guardians.userId))
    .where(and(
      eq(studentGuardians.studentId, studentId), eq(studentGuardians.active, true),
      eq(guardians.active, true), eq(user.active, true),
    ));
  return notifyUsers(recipients.map(row => row.id), notice);
}
