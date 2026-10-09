import { isNull } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Better Auth owns these tables. Its Drizzle adapter reads the same schema.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("session_user_idx").on(t.userId)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("account_user_idx").on(t.userId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

export const rateLimit = sqliteTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => user.id),
  role: text("role", { enum: ["superadmin", "direccion", "docente", "tutor", "alumno"] }).notNull(),
  assignedBy: text("assigned_by").references(() => user.id),
  assignedAt: integer("assigned_at", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] }), index("user_roles_role_idx").on(t.role)]);

export const schoolYears = sqliteTable("school_years", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  yearId: text("year_id").notNull().references(() => schoolYears.id),
  name: text("name").notNull(),
  stage: text("stage", { enum: ["lactantes", "maternal", "prekinder", "preescolar"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [uniqueIndex("groups_year_name_idx").on(t.yearId, t.name)]);

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  birthDate: text("birth_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("students_name_idx").on(t.familyName, t.givenName)]);

export const enrollments = sqliteTable("enrollments", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  groupId: text("group_id").notNull().references(() => groups.id),
  enrolledAt: integer("enrolled_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
}, (t) => [uniqueIndex("enrollments_student_group_active_idx").on(t.studentId, t.groupId).where(isNull(t.endedAt)), index("enrollments_group_idx").on(t.groupId)]);

export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const teacherGroups = sqliteTable("teacher_groups", {
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  groupId: text("group_id").notNull().references(() => groups.id),
}, (t) => [primaryKey({ columns: [t.teacherId, t.groupId] }), index("teacher_groups_group_idx").on(t.groupId)]);

export const guardians = sqliteTable("guardians", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const studentGuardians = sqliteTable("student_guardians", {
  studentId: text("student_id").notNull().references(() => students.id),
  guardianId: text("guardian_id").notNull().references(() => guardians.id),
  relationship: text("relationship").notNull(),
  mayCollect: integer("may_collect", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [primaryKey({ columns: [t.studentId, t.guardianId] }), index("student_guardians_guardian_idx").on(t.guardianId)]);

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => user.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)]);

export const setupState = sqliteTable("setup_state", {
  key: text("key").primaryKey(),
  completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
});

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  objectKey: text("object_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  purpose: text("purpose", { enum: ["material", "submission", "message", "recording"] }).notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => user.id),
  groupId: text("group_id").references(() => groups.id),
  studentId: text("student_id").references(() => students.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
}, (t) => [index("files_group_idx").on(t.groupId), index("files_student_idx").on(t.studentId)]);

export const materials = sqliteTable("materials", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => files.id),
  groupId: text("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  publishedBy: text("published_by").notNull().references(() => user.id),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("materials_group_idx").on(t.groupId, t.publishedAt)]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  dueAt: integer("due_at", { mode: "timestamp" }),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
}, (t) => [index("tasks_group_due_idx").on(t.groupId, t.dueAt)]);

export const taskFiles = sqliteTable("task_files", {
  taskId: text("task_id").notNull().references(() => tasks.id),
  fileId: text("file_id").notNull().references(() => files.id),
}, (t) => [primaryKey({ columns: [t.taskId, t.fileId] })]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  studentId: text("student_id").notNull().references(() => students.id),
  submittedBy: text("submitted_by").notNull().references(() => user.id),
  status: text("status", { enum: ["entregada", "revisada", "completada"] }).notNull(),
  note: text("note"),
  evaluation: text("evaluation", { enum: ["logrado", "en_proceso", "con_acompanamiento"] }),
  reviewedBy: text("reviewed_by").references(() => user.id),
  reviewNote: text("review_note"),
  submittedAt: integer("submitted_at", { mode: "timestamp" }).notNull(),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
}, (t) => [uniqueIndex("submissions_task_student_idx").on(t.taskId, t.studentId)]);

export const submissionFiles = sqliteTable("submission_files", {
  submissionId: text("submission_id").notNull().references(() => submissions.id),
  fileId: text("file_id").notNull().references(() => files.id),
}, (t) => [primaryKey({ columns: [t.submissionId, t.fileId] })]);

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").references(() => groups.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp" }),
  createdBy: text("created_by").notNull().references(() => user.id),
}, (t) => [index("events_start_idx").on(t.startsAt), index("events_group_idx").on(t.groupId)]);

export const classSessions = sqliteTable("class_sessions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique().references(() => calendarEvents.id),
  groupId: text("group_id").notNull().references(() => groups.id),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  meetUrl: text("meet_url"),
  recordingAllowed: integer("recording_allowed", { mode: "boolean" }).notNull().default(false),
  recordingFileId: text("recording_file_id").references(() => files.id),
}, (t) => [index("class_sessions_group_idx").on(t.groupId)]);

export const attendance = sqliteTable("attendance", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  groupId: text("group_id").notNull().references(() => groups.id),
  onDate: text("on_date").notNull(),
  status: text("status", { enum: ["presente", "ausente", "retardo", "justificada"] }).notNull(),
  note: text("note"),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  modifiedBy: text("modified_by").references(() => user.id),
  modifiedAt: integer("modified_at", { mode: "timestamp" }),
}, (t) => [uniqueIndex("attendance_student_date_idx").on(t.studentId, t.onDate), index("attendance_group_date_idx").on(t.groupId, t.onDate)]);

export const attendanceJustifications = sqliteTable("attendance_justifications", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  groupId: text("group_id").notNull().references(() => groups.id),
  onDate: text("on_date").notNull(),
  submittedBy: text("submitted_by").notNull().references(() => user.id),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pendiente", "aceptada", "rechazada"] }).notNull().default("pendiente"),
  reviewedBy: text("reviewed_by").references(() => user.id),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [uniqueIndex("attendance_justifications_student_date_idx").on(t.studentId, t.onDate), index("attendance_justifications_group_date_idx").on(t.groupId, t.onDate)]);

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  category: text("category").notNull(),
  body: text("body").notNull(),
  visibleToFamily: integer("visible_to_family", { mode: "boolean" }).notNull().default(false),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("observations_student_idx").on(t.studentId, t.recordedAt)]);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
  guardianId: text("guardian_id").notNull().references(() => guardians.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [uniqueIndex("conversation_participants_idx").on(t.studentId, t.teacherId, t.guardianId)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  authorId: text("author_id").notNull().references(() => user.id),
  body: text("body").notNull(),
  fileId: text("file_id").references(() => files.id),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
  readAt: integer("read_at", { mode: "timestamp" }),
}, (t) => [index("messages_conversation_idx").on(t.conversationId, t.sentAt)]);

export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  groupId: text("group_id").references(() => groups.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  publishedBy: text("published_by").notNull().references(() => user.id),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("announcements_group_idx").on(t.groupId, t.publishedAt)]);

export const announcementReads = sqliteTable("announcement_reads", {
  announcementId: text("announcement_id").notNull().references(() => announcements.id),
  userId: text("user_id").notNull().references(() => user.id),
  readAt: integer("read_at", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.announcementId, t.userId] })]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  href: text("href"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  readAt: integer("read_at", { mode: "timestamp" }),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const communicationSettings = sqliteTable("communication_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  weekdays: text("weekdays").notNull().default("1,2,3,4,5"),
  startTime: text("start_time").notNull().default("08:00"),
  endTime: text("end_time").notNull().default("17:00"),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  guardianId: text("guardian_id").notNull().references(() => guardians.id),
  purpose: text("purpose").notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull(),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  noticeVersion: text("notice_version"),
  evidenceReference: text("evidence_reference"),
  recordedBy: text("recorded_by").references(() => user.id),
});

export const privacyNotices = sqliteTable("privacy_notices", {
  id: text("id").primaryKey(),
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
  approvedBy: text("approved_by").notNull().references(() => user.id),
  approvedAt: integer("approved_at", { mode: "timestamp" }).notNull(),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("privacy_notice_published_idx").on(t.publishedAt)]);

export const privacyRequests = sqliteTable("privacy_requests", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id),
  requesterId: text("requester_id").notNull().references(() => user.id),
  kind: text("kind").notNull(),
  details: text("details").notNull(),
  status: text("status").notNull().default("recibida"),
  openKey: text("open_key"),
  responseNote: text("response_note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  respondedAt: integer("responded_at", { mode: "timestamp" }),
  resolvedBy: text("resolved_by").references(() => user.id),
}, (t) => [index("privacy_request_student_idx").on(t.studentId, t.createdAt), index("privacy_request_requester_idx").on(t.requesterId, t.createdAt), uniqueIndex("privacy_request_open_key_idx").on(t.openKey)]);

export const activityProgress = sqliteTable("activity_progress", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  activityId: text("activity_id").notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
  artworkJson: text("artwork_json"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [uniqueIndex("activity_progress_student_activity_idx").on(t.studentId, t.activityId), index("activity_progress_student_idx").on(t.studentId, t.completedAt)]);
