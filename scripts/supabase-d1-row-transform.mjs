import { buildLegacyUserIdMap, rewriteLegacyUserReferences } from "./supabase-identity-migration.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ONLY_TABLES = new Set(["user", "session", "account", "verification", "rateLimit", "setup_state"]);

function stop(message) {
  throw new Error(`Conversión D1 → Supabase detenida: ${message}`);
}

/** Parse public table columns, Postgres types, and declaration order. */
export function parseSupabaseMigrationSchema(sql) {
  if (typeof sql !== "string") stop("no se pudo leer la migración de esquema.");
  const tables = [];
  for (const [, name, body] of sql.matchAll(/create\s+table\s+public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const columns = [];
    const primaryKey = [];
    const types = {};
    for (const line of body.split("\n")) {
      const column = line.match(/^\s*([a-z_][a-z0-9_]*)\s+(uuid|text|timestamptz|boolean|integer)\b/i);
      if (column) {
        const field = column[1].toLowerCase();
        const type = column[2].toLowerCase();
        columns.push(field);
        types[field] = type;
        if (/\bprimary\s+key\b/i.test(line)) primaryKey.push(field);
      }
      const tableKey = line.match(/^\s*primary\s+key\s*\(([^)]+)\)/i);
      if (tableKey) primaryKey.push(...tableKey[1].split(",").map(value => value.trim().toLowerCase()));
    }
    if (!columns.length || !primaryKey.length || primaryKey.some(key => !columns.includes(key))) stop(`la definición de public.${name} no es válida.`);
    tables.push({ name, columns, primaryKey, types });
  }
  if (!tables.length) stop("la migración no declara tablas públicas.");
  return tables;
}

function toTimestamp(value, table, column) {
  if (value == null) return null;
  let date;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    // Drizzle SQLite `mode: timestamp` stores Unix seconds.
    date = new Date(value * 1000);
  } else if (typeof value === "string") {
    date = new Date(value);
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) stop(`public.${table}.${column} contiene una fecha no válida.`);
  return date.toISOString();
}

function toBoolean(value, table, column) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  stop(`public.${table}.${column} no es un booleano válido.`);
}

function normalizeRow(table, row, definition) {
  if (!row || typeof row !== "object" || Array.isArray(row)) stop(`public.${table} contiene una fila inválida.`);
  const sourceColumns = Object.keys(row).sort();
  if (JSON.stringify(sourceColumns) !== JSON.stringify([...definition.columns].sort())) stop(`las columnas de public.${table} no coinciden con el destino.`);
  const output = {};
  for (const column of definition.columns) {
    let value = row[column];
    if (definition.types[column] === "uuid" && value != null && (typeof value !== "string" || !UUID.test(value))) {
      stop(`public.${table}.${column} no contiene un UUID válido después del mapeo.`);
    }
    if (definition.types[column] === "timestamptz") value = toTimestamp(value, table, column);
    if (definition.types[column] === "boolean") value = toBoolean(value, table, column);
    if (definition.types[column] === "integer" && value != null && (!Number.isSafeInteger(value))) {
      stop(`public.${table}.${column} no contiene un entero válido.`);
    }
    output[column] = value;
  }
  return output;
}

/**
 * Convert a D1 snapshot to the Supabase table shape. Account IDs are mapped
 * through the Auth identities already created by the school. Auth passwords,
 * sessions, and verification tokens are intentionally omitted.
 */
export function transformD1SchoolRows(sourceRows, supabaseUsers, definitions) {
  if (!sourceRows || typeof sourceRows !== "object" || !Array.isArray(sourceRows.user) || !Array.isArray(definitions)) {
    stop("el respaldo no contiene las tablas esperadas.");
  }
  const legacyUsers = sourceRows.user.map(({ id, email }) => ({ id, email }));
  const identityMap = buildLegacyUserIdMap(legacyUsers, supabaseUsers);
  const rowsByTable = {};

  // Supabase Auth's profile trigger owns identity creation; these fields fill
  // its school-specific profile after the corresponding Auth identity exists.
  const profileDefinition = definitions.find(table => table.name === "profiles");
  if (!profileDefinition) stop("falta public.profiles en la migración.");
  rowsByTable.profiles = sourceRows.user.map(row => normalizeRow("profiles", {
    id: identityMap.get(row.id), name: row.name, email: row.email,
    email_verified: row.email_verified, active: row.active, image: row.image,
    created_at: row.created_at, updated_at: row.updated_at,
  }, profileDefinition));

  const translated = rewriteLegacyUserReferences(sourceRows, identityMap);
  translated.audit_log = (translated.audit_log ?? []).map(row => ({
    ...row,
    ...(row.entity_type === "user" && identityMap.has(row.entity_id) ? { entity_id: identityMap.get(row.entity_id) } : {}),
  }));

  for (const definition of definitions) {
    if (definition.name === "profiles") continue;
    const source = translated[definition.name];
    if (!Array.isArray(source)) stop(`falta la tabla de origen ${definition.name}.`);
    rowsByTable[definition.name] = source.map(row => normalizeRow(definition.name, row, definition));
  }
  for (const sourceOnly of SOURCE_ONLY_TABLES) delete rowsByTable[sourceOnly];
  return { rowsByTable, identityMap };
}
