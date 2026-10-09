import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, guardians, studentGuardians, students, teachers } from "@/db/schema";
import { canAccessConversation } from "@/lib/conversation-access-policy";

export type ConversationAccessRecord = {
  id: string;
  studentId: string;
  guardianUserId: string;
  teacherUserId: string;
  guardianActive: boolean;
  teacherActive: boolean;
  studentActive: boolean;
  studentGuardianActive: boolean | null;
  recipientId: string;
};

/** Shared participant check for reading a conversation or its attachments. */
export async function authorizedConversation(id: string, actorId: string, roles: readonly string[]) {
  const db = getDb();
  const row = await db.select({
    id: conversations.id,
    studentId: conversations.studentId,
    guardianUserId: guardians.userId,
    teacherUserId: teachers.userId,
    guardianActive: guardians.active,
    teacherActive: teachers.active,
    studentActive: students.active,
    studentGuardianActive: studentGuardians.active,
  })
    .from(conversations)
    .innerJoin(guardians, eq(guardians.id, conversations.guardianId))
    .innerJoin(teachers, eq(teachers.id, conversations.teacherId))
    .innerJoin(students, eq(students.id, conversations.studentId))
    .leftJoin(studentGuardians, and(
      eq(studentGuardians.studentId, conversations.studentId),
      eq(studentGuardians.guardianId, conversations.guardianId),
    ))
    .where(eq(conversations.id, id))
    .limit(1);
  if (!row.length || !canAccessConversation(row[0], actorId, roles)) return null;
  const record = row[0];
  return {
    ...record,
    recipientId: roles.includes("tutor") && record.guardianUserId === actorId ? record.teacherUserId : record.guardianUserId,
  } satisfies ConversationAccessRecord;
}
