import { env } from "@/lib/runtime/env";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolAuthClient, type AuthUser } from "@/lib/supabase/auth";

// Keep this list aligned with supabase/migrations/20261008000000_school_schema.sql.
// It is deliberately static so no user input can become a SQL identifier or URL path.
const schoolTables = [
  "profiles",
  "user_roles",
  "school_years",
  "groups",
  "students",
  "enrollments",
  "teachers",
  "teacher_groups",
  "guardians",
  "student_guardians",
  "audit_log",
  "files",
  "materials",
  "tasks",
  "task_files",
  "submissions",
  "submission_files",
  "calendar_events",
  "class_sessions",
  "attendance",
  "attendance_justifications",
  "observations",
  "conversations",
  "messages",
  "announcements",
  "announcement_reads",
  "notifications",
  "communication_settings",
  "consents",
  "privacy_notices",
  "privacy_requests",
  "activity_progress",
] as const;

const d1SchoolTables = schoolTables.filter((table) => table !== "profiles");

type CountResult = { count: number };
type EmailResult = { email: string };

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function countEmails(emails: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const normalized = normalizedEmail(email);
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function parseExactCount(response: Response) {
  const range = response.headers.get("content-range");
  const match = range?.match(/\/(\d+)$/);
  if (!match) throw new Error("count_unavailable");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("count_unavailable");
  return count;
}

async function countSupabaseTable(table: typeof schoolTables[number], baseUrl: string, secretKey: string) {
  const url = new URL(`/rest/v1/${table}?select=*`, baseUrl);
  let response: Response;
  try {
    const headers: Record<string, string> = {
      apikey: secretKey,
      Accept: "application/json",
      Prefer: "count=exact",
      "Range-Unit": "items",
      Range: "0-0",
    };
    // New API keys are opaque strings; legacy service_role keys are JWTs.
    // Keep the legacy bearer behavior while never sending sb_secret_* as JWT.
    if (!secretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${secretKey}`;
    response = await fetch(url, {
      method: "HEAD",
      headers,
      redirect: "error",
    });
  } catch {
    throw new Error("supabase_unavailable");
  }
  if (!response.ok) throw new Error("supabase_unavailable");
  return parseExactCount(response);
}

function safeProjectUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");

  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin")) return errorResponse(403, "Solo Superadministración puede revisar la migración.");

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    return errorResponse(409, "El portal ya utiliza Supabase. La revisión de migración desde D1 no se aplica a este sistema.");
  }
  const projectUrl = safeProjectUrl(env.SUPABASE_URL);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!env.DB || !projectUrl || !secretKey || /[\r\n]/.test(secretKey)) {
    return errorResponse(503, "La conexión de previsualización no está configurada.");
  }

  try {
    const d1Counts: Record<string, number> = {};
    for (const table of d1SchoolTables) {
      const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first<CountResult>();
      if (!result || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error("d1_unavailable");
      d1Counts[table] = result.count;
    }

    const d1Accounts = await env.DB.prepare("SELECT email FROM \"user\"").all<EmailResult>();
    if (!d1Accounts.success || !Array.isArray(d1Accounts.results)) throw new Error("d1_unavailable");
    const d1Emails = d1Accounts.results.map((row) => row.email);
    const d1Superadmins = await env.DB.prepare(
      "SELECT \"user\".email AS email FROM \"user\" INNER JOIN user_roles ON user_roles.user_id = \"user\".id WHERE user_roles.role = ?",
    ).bind("superadmin").all<EmailResult>();
    if (!d1Superadmins.success || !Array.isArray(d1Superadmins.results)) throw new Error("d1_unavailable");

    const auth = createSchoolAuthClient(env);
    const authUsers: AuthUser[] = await auth.admin.listUsers();
    const supabaseEmailCounts = countEmails(authUsers.map((user) => user.email));
    const d1EmailCounts = countEmails(d1Emails);
    let matchedAccounts = 0;
    let unmatchedAccounts = 0;
    let ambiguousD1Accounts = 0;
    for (const [email, sourceCount] of d1EmailCounts) {
      if (sourceCount !== 1) {
        ambiguousD1Accounts += sourceCount;
      } else if (!isEmail(email)) {
        unmatchedAccounts++;
      } else if ((supabaseEmailCounts.get(email) ?? 0) === 1) {
        matchedAccounts++;
      } else {
        unmatchedAccounts++;
      }
    }
    const invalidD1Emails = d1Emails.filter((email) => !isEmail(normalizedEmail(email))).length;
    const ambiguousSupabaseEmails = [...supabaseEmailCounts.values()].filter((count) => count > 1).length;
    const mappedSuperadmins = d1Superadmins.results.filter((row) => {
      const email = normalizedEmail(row.email);
      return isEmail(email) && d1EmailCounts.get(email) === 1 && supabaseEmailCounts.get(email) === 1;
    }).length;

    const targetCounts: Record<string, number> = {};
    const entries = await Promise.all(schoolTables.map(async (table) => [
      table,
      await countSupabaseTable(table, projectUrl.toString(), secretKey),
    ] as const));
    for (const [table, count] of entries) targetCounts[table] = count;

    const blockers: Array<{ code: string; count?: number }> = [];
    if (unmatchedAccounts > 0) blockers.push({ code: "d1_accounts_missing_from_supabase_auth", count: unmatchedAccounts });
    if (invalidD1Emails > 0) blockers.push({ code: "invalid_d1_account_emails", count: invalidD1Emails });
    if (ambiguousD1Accounts > 0) blockers.push({ code: "duplicate_d1_account_emails", count: ambiguousD1Accounts });
    if (ambiguousSupabaseEmails > 0) blockers.push({ code: "duplicate_supabase_auth_emails", count: ambiguousSupabaseEmails });
    if (mappedSuperadmins === 0) blockers.push({ code: "superadmin_account_missing_from_supabase_auth" });
    // Counts and identity matches alone cannot prove that every D1 relation,
    // UUID, or referenced R2 object can be migrated safely.
    blockers.push({ code: "d1_integrity_and_file_objects_not_verified" });

    const occupiedTargets = Object.entries(targetCounts)
      .filter(([table, count]) => table !== "profiles" && count > 0)
      .reduce((sum, [, count]) => sum + count, 0);
    if (occupiedTargets > 0) blockers.push({ code: "supabase_school_tables_not_empty", count: occupiedTargets });
    const profileEligibleAuthUsers = authUsers.filter((user) => typeof user.email === "string").length;
    if (targetCounts.profiles !== profileEligibleAuthUsers) {
      blockers.push({ code: "supabase_profiles_do_not_match_auth_users", count: Math.abs(targetCounts.profiles - profileEligibleAuthUsers) });
    }

    return Response.json({
      ready: blockers.length === 0,
      source: { accounts: d1Emails.length, tables: d1Counts },
      destination: { authUsers: authUsers.length, tables: targetCounts },
      accountMatches: {
        matched: matchedAccounts,
        unmatched: unmatchedAccounts,
        ambiguousInSource: ambiguousD1Accounts,
      },
      blockers,
      readOnly: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Avoid forwarding upstream errors: they can contain project metadata or credentials.
    return errorResponse(503, "No se pudo completar la previsualización. Revisa la conexión y vuelve a intentar.");
  }
}
