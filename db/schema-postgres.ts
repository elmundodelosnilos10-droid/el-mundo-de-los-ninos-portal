/**
 * Typed mapping for the existing public Supabase school tables.
 *
 * This file does not create/migrate tables and is intentionally not imported
 * by the D1 runtime. Integrate only after replacing the D1 query/session paths.
 * `user` aliases public.profiles: its id is exactly the Supabase Auth UUID.
 * Timestamps map to Date, booleans to boolean, school date-only values to text.
 * Auth sessions/accounts/passwords are owned by Supabase Auth and omitted here.
 */
import { isNull, sql } from "drizzle-orm";
import { boolean, check, index, integer, pgSchema, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Reference metadata only: Auth remains managed by Supabase, never by Drizzle.
const authUsersReference = pgSchema("auth").table("users", { id: uuid("id").primaryKey() });

export const user = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  active: boolean("active").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => user.id),
  role: text("role", { enum: ["superadmin", "direccion", "docente", "tutor", "alumno"] }).notNull(),
  assignedBy: uuid("assigned_by").references(() => user.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] }), index("user_roles_role_idx").on(t.role)]);

export const schoolYears = pgTable("school_years", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  active: boolean("active").notNull().default(false),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey(),
  yearId: uuid("year_id").notNull().references(() => schoolYears.id),
  name: text("name").notNull(),
  stage: text("stage", { enum: ["lactantes", "maternal", "prekinder", "preescolar"] }).notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("groups_year_name_idx").on(t.yearId, t.name)]);

export const students = pgTable("students", {
  id: uuid("id").primaryKey(),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  birthDate: text("birth_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [index("students_name_idx").on(t.familyName, t.givenName)]);

export const enrollments = pgTable("enrollments", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "date" }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
}, (t) => [uniqueIndex("enrollments_student_group_active_idx").on(t.studentId, t.groupId).where(isNull(t.endedAt)), index("enrollments_group_idx").on(t.groupId)]);

export const teachers = pgTable("teachers", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => user.id),
  active: boolean("active").notNull().default(true),
});

export const teacherGroups = pgTable("teacher_groups", {
  teacherId: uuid("teacher_id").notNull().references(() => teachers.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
}, (t) => [primaryKey({ columns: [t.teacherId, t.groupId] }), index("teacher_groups_group_idx").on(t.groupId)]);

export const guardians = pgTable("guardians", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => user.id),
  active: boolean("active").notNull().default(true),
});

export const studentGuardians = pgTable("student_guardians", {
  studentId: uuid("student_id").notNull().references(() => students.id),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
  relationship: text("relationship").notNull(),
  mayCollect: boolean("may_collect").notNull().default(false),
  active: boolean("active").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.studentId, t.guardianId] }), index("student_guardians_guardian_idx").on(t.guardianId)]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id").references(() => user.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey(),
  objectKey: text("object_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  purpose: text("purpose", { enum: ["material", "submission", "message", "recording"] }).notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => user.id),
  groupId: uuid("group_id").references(() => groups.id),
  studentId: uuid("student_id").references(() => students.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("files_group_idx").on(t.groupId), index("files_student_idx").on(t.studentId)]);

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey(),
  fileId: uuid("file_id").notNull().references(() => files.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  publishedBy: uuid("published_by").notNull().references(() => user.id),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [index("materials_group_idx").on(t.groupId, t.publishedAt)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
  createdBy: uuid("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("tasks_group_due_idx").on(t.groupId, t.dueAt)]);

export const taskFiles = pgTable("task_files", {
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  fileId: uuid("file_id").notNull().references(() => files.id),
}, (t) => [primaryKey({ columns: [t.taskId, t.fileId] })]);

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  submittedBy: uuid("submitted_by").notNull().references(() => user.id),
  status: text("status", { enum: ["entregada", "revisada", "completada"] }).notNull(),
  note: text("note"),
  evaluation: text("evaluation", { enum: ["logrado", "en_proceso", "con_acompanamiento"] }),
  reviewedBy: uuid("reviewed_by").references(() => user.id),
  reviewNote: text("review_note"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
}, (t) => [uniqueIndex("submissions_task_student_idx").on(t.taskId, t.studentId)]);

export const submissionFiles = pgTable("submission_files", {
  submissionId: uuid("submission_id").notNull().references(() => submissions.id),
  fileId: uuid("file_id").notNull().references(() => files.id),
}, (t) => [primaryKey({ columns: [t.submissionId, t.fileId] })]);

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").references(() => groups.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
  createdBy: uuid("created_by").notNull().references(() => user.id),
}, (t) => [index("events_start_idx").on(t.startsAt), index("events_group_idx").on(t.groupId)]);

export const classSessions = pgTable("class_sessions", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().references(() => calendarEvents.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  teacherId: uuid("teacher_id").notNull().references(() => teachers.id),
  meetUrl: text("meet_url"),
  recordingAllowed: boolean("recording_allowed").notNull().default(false),
  recordingFileId: uuid("recording_file_id").references(() => files.id),
}, (t) => [index("class_sessions_group_idx").on(t.groupId)]);

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  onDate: text("on_date").notNull(),
  status: text("status", { enum: ["presente", "ausente", "retardo", "justificada"] }).notNull(),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull().references(() => user.id),
  modifiedBy: uuid("modified_by").references(() => user.id),
  modifiedAt: timestamp("modified_at", { withTimezone: true, mode: "date" }),
}, (t) => [uniqueIndex("attendance_student_date_idx").on(t.studentId, t.onDate), index("attendance_group_date_idx").on(t.groupId, t.onDate)]);

export const attendanceJustifications = pgTable("attendance_justifications", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  onDate: text("on_date").notNull(),
  submittedBy: uuid("submitted_by").notNull().references(() => user.id),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pendiente", "aceptada", "rechazada"] }).notNull().default("pendiente"),
  reviewedBy: uuid("reviewed_by").references(() => user.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [uniqueIndex("attendance_justifications_student_date_idx").on(t.studentId, t.onDate), index("attendance_justifications_group_date_idx").on(t.groupId, t.onDate)]);

export const observations = pgTable("observations", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  category: text("category").notNull(),
  body: text("body").notNull(),
  visibleToFamily: boolean("visible_to_family").notNull().default(false),
  recordedBy: uuid("recorded_by").notNull().references(() => user.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [index("observations_student_idx").on(t.studentId, t.recordedAt)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  teacherId: uuid("teacher_id").notNull().references(() => teachers.id),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [uniqueIndex("conversation_participants_idx").on(t.studentId, t.teacherId, t.guardianId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
  authorId: uuid("author_id").notNull().references(() => user.id),
  body: text("body").notNull(),
  fileId: uuid("file_id").references(() => files.id),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("messages_conversation_idx").on(t.conversationId, t.sentAt)]);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").references(() => groups.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  important: boolean("important").notNull().default(false),
  publishedBy: uuid("published_by").notNull().references(() => user.id),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [index("announcements_group_idx").on(t.groupId, t.publishedAt)]);

export const announcementReads = pgTable("announcement_reads", {
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id),
  userId: uuid("user_id").notNull().references(() => user.id),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [primaryKey({ columns: [t.announcementId, t.userId] })]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => user.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  href: text("href"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const communicationSettings = pgTable("communication_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  weekdays: text("weekdays").notNull().default("1,2,3,4,5"),
  startTime: text("start_time").notNull().default("08:00"),
  endTime: text("end_time").notNull().default("17:00"),
  updatedBy: uuid("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
  purpose: text("purpose").notNull(),
  granted: boolean("granted").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  noticeVersion: text("notice_version"),
  evidenceReference: text("evidence_reference"),
  recordedBy: uuid("recorded_by").references(() => user.id),
});

export const privacyNotices = pgTable("privacy_notices", {
  id: uuid("id").primaryKey(),
  version: text("version").notNull().unique(),
  responsibleName: text("responsible_name").notNull(),
  address: text("address").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  personalDataCategories: text("personal_data_categories").notNull(),
  sensitiveDataCategories: text("sensitive_data_categories").notNull(),
  purposes: text("purposes").notNull(),
  consentPurposes: text("consent_purposes").notNull(),
  limitationMeans: text("limitation_means").notNull(),
  arcoProcedure: text("arco_procedure").notNull(),
  noticeChanges: text("notice_changes").notNull(),
  processorsAndTransfers: text("processors_and_transfers").notNull(),
  effectiveDate: text("effective_date").notNull(),
  approvedBy: uuid("approved_by").notNull().references(() => user.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [index("privacy_notice_published_idx").on(t.publishedAt)]);

export const privacyRequests = pgTable("privacy_requests", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  requesterId: uuid("requester_id").notNull().references(() => user.id),
  kind: text("kind").notNull(),
  details: text("details").notNull(),
  status: text("status").notNull().default("recibida"),
  openKey: text("open_key"),
  responseNote: text("response_note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
  resolvedBy: uuid("resolved_by").references(() => user.id),
}, (t) => [index("privacy_request_student_idx").on(t.studentId, t.createdAt), index("privacy_request_requester_idx").on(t.requesterId, t.createdAt), uniqueIndex("privacy_request_open_key_idx").on(t.openKey)]);

export const activityProgress = pgTable("activity_progress", {
  id: uuid("id").primaryKey(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  activityId: text("activity_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
  artworkJson: text("artwork_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [uniqueIndex("activity_progress_student_activity_idx").on(t.studentId, t.activityId), index("activity_progress_student_idx").on(t.studentId, t.completedAt)]);

export { user as profiles };

/** Private RPC recovery state. No authenticated/anonymous table privileges. */
export const schoolAccountInvitationProvisions = pgTable("school_account_invitation_provisions", {
  authUserId: uuid("auth_user_id").primaryKey().references(() => authUsersReference.id),
  invitationNonce: uuid("invitation_nonce").notNull().unique(),
  inviterId: uuid("inviter_id").notNull().references(() => user.id),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true, mode: "date" }).notNull(),
  state: text("state", { enum: ["provisioned", "quarantined", "managed"] }).notNull(),
}, (t) => [check("school_account_invitation_provisions_state_check", sql`${t.state} in ('provisioned', 'quarantined', 'managed')`)]);
