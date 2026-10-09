export type ConversationParticipantState = {
  guardianUserId: string;
  teacherUserId: string;
  guardianActive: boolean;
  teacherActive: boolean;
  studentActive: boolean;
  studentGuardianActive: boolean | null;
};

/** Return true only for an active participant with a live tutor-student link. */
export function canAccessConversation(
  conversation: ConversationParticipantState,
  actorId: string,
  roles: readonly string[],
): boolean {
  if (!conversation.guardianActive || !conversation.teacherActive || !conversation.studentActive) return false;
  if (roles.includes("tutor") && conversation.guardianUserId === actorId && conversation.studentGuardianActive === true) return true;
  return roles.includes("docente") && conversation.teacherUserId === actorId;
}
