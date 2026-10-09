const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only these columns point to Better Auth's text user.id. Entity IDs such as
// student_id and group_id are retained, so they must never be remapped here.
export const legacyUserReferences = Object.freeze({
  user_roles: ["user_id", "assigned_by"],
  teachers: ["user_id"],
  guardians: ["user_id"],
  audit_log: ["actor_id"],
  files: ["uploaded_by"],
  materials: ["published_by"],
  tasks: ["created_by"],
  submissions: ["submitted_by", "reviewed_by"],
  calendar_events: ["created_by"],
  attendance: ["recorded_by", "modified_by"],
  attendance_justifications: ["submitted_by", "reviewed_by"],
  observations: ["recorded_by"],
  messages: ["author_id"],
  announcements: ["published_by"],
  announcement_reads: ["user_id"],
  notifications: ["user_id"],
  communication_settings: ["updated_by"],
  consents: ["recorded_by"],
  privacy_notices: ["approved_by"],
  privacy_requests: ["requester_id", "resolved_by"],
});

function fail(message) {
  throw new Error(`Migración Supabase detenida: ${message}`);
}

function normalizedEmail(email) {
  if (typeof email !== "string" || !email.trim() || email.length > 320) fail("una cuenta no tiene correo válido.");
  return email.trim().toLowerCase();
}

/**
 * Pair Better Auth accounts with identities already provisioned in Supabase Auth.
 * This is a read-only mapping; it never creates accounts or changes either DB.
 */
export function buildLegacyUserIdMap(legacyAccounts, supabaseUsers) {
  if (!Array.isArray(legacyAccounts) || !Array.isArray(supabaseUsers)) fail("las listas de cuentas no tienen formato válido.");

  const legacyByEmail = new Map();
  for (const account of legacyAccounts) {
    if (!account || typeof account.id !== "string" || !account.id.trim()) fail("una cuenta de origen no tiene ID.");
    const email = normalizedEmail(account.email);
    if (legacyByEmail.has(email)) fail("hay correos repetidos en las cuentas de origen.");
    legacyByEmail.set(email, account);
  }

  const supabaseByEmail = new Map();
  const supabaseIds = new Set();
  for (const user of supabaseUsers) {
    if (!user || typeof user.id !== "string" || !UUID.test(user.id)) fail("Supabase Auth devolvió una identidad con UUID no válido.");
    const email = normalizedEmail(user.email);
    if (supabaseByEmail.has(email) || supabaseIds.has(user.id.toLowerCase())) fail("hay identidades Supabase duplicadas.");
    supabaseByEmail.set(email, user);
    supabaseIds.add(user.id.toLowerCase());
  }

  const result = new Map();
  for (const [email, account] of legacyByEmail) {
    const user = supabaseByEmail.get(email);
    if (!user) fail("falta una identidad Supabase para una cuenta de origen; no se modificaron datos.");
    result.set(account.id, user.id);
  }
  return result;
}

/** Translate only declared Better Auth user references, preserving entity IDs. */
export function rewriteLegacyUserReferences(rowsByTable, userIdMap) {
  if (!rowsByTable || typeof rowsByTable !== "object" || !(userIdMap instanceof Map)) fail("faltan los datos o el mapa de identidades.");
  const translated = { ...rowsByTable };
  for (const [table, columns] of Object.entries(legacyUserReferences)) {
    const rows = rowsByTable[table] ?? [];
    if (!Array.isArray(rows)) fail(`public.${table} no es una lista de registros.`);
    translated[table] = rows.map((row, rowIndex) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail(`public.${table} contiene un registro inválido.`);
      const copy = { ...row };
      for (const column of columns) {
        const legacyId = copy[column];
        if (legacyId == null) continue;
        if (typeof legacyId !== "string" || !userIdMap.has(legacyId)) {
          fail(`public.${table}[${rowIndex}].${column} no tiene correspondencia de identidad.`);
        }
        copy[column] = userIdMap.get(legacyId);
      }
      return copy;
    });
  }
  return translated;
}
