"use client";

import { useState } from "react";

interface CountTree { [key: string]: number | CountTree | null | undefined }
type Blocker = string | { code?: string; message?: string; count?: number };
type PreflightResult = {
  ready?: boolean;
  status?: string;
  counts?: CountTree;
  source?: { accounts?: number; tables?: CountTree };
  destination?: { authUsers?: number; tables?: CountTree };
  accountMatches?: { matched?: number; unmatched?: number; ambiguousInSource?: number };
  missingAuth?: number | string[] | { count?: number };
  blockers?: Blocker[];
  error?: string;
};

const countLabels: Record<string, string> = {
  users: "Cuentas del portal",
  legacyUsers: "Cuentas actuales",
  supabaseAuthUsers: "Cuentas en Supabase Auth",
  authUsers: "Cuentas en Supabase Auth",
  matchedUsers: "Cuentas vinculadas",
  missingAuth: "Cuentas pendientes en Supabase Auth",
  missingAuthUsers: "Cuentas pendientes en Supabase Auth",
  students: "Alumnos",
  groups: "Grupos",
  classes: "Clases virtuales",
  attendance: "Registros de asistencia",
  tasks: "Tareas",
  submissions: "Entregas",
  materials: "Materiales",
  files: "Archivos",
  announcements: "Comunicados",
  conversations: "Conversaciones",
  calendarEvents: "Eventos del calendario",
  profiles: "Perfiles Supabase existentes",
  targetRows: "Registros existentes en destino",
  accounts: "Cuentas actuales",
  matched: "Cuentas vinculadas por correo",
  unmatched: "Cuentas sin coincidencia en Supabase Auth",
  ambiguousInSource: "Cuentas con correo duplicado en el portal",
  school_years: "Ciclos escolares",
  teacher_groups: "Asignaciones de maestras",
  student_guardians: "Relaciones de alumnos y tutores",
  audit_log: "Registros de auditoría",
  task_files: "Archivos vinculados a tareas",
  submission_files: "Archivos vinculados a entregas",
  calendar_events: "Eventos del calendario",
  class_sessions: "Clases virtuales",
  attendance_justifications: "Justificantes de asistencia",
  activity_progress: "Avances de actividades",
  communication_settings: "Ajustes de comunicación",
  privacy_notices: "Avisos de privacidad",
  privacy_requests: "Solicitudes de privacidad",
  announcement_reads: "Lecturas de comunicados",
};

const blockerLabels: Record<string, string> = {
  d1_accounts_missing_from_supabase_auth: "Faltan cuentas del portal en Supabase Auth.",
  invalid_d1_account_emails: "Hay cuentas actuales con un correo no válido.",
  duplicate_d1_account_emails: "Hay correos duplicados entre las cuentas actuales.",
  duplicate_supabase_auth_emails: "Hay correos duplicados en Supabase Auth.",
  superadmin_account_missing_from_supabase_auth: "La cuenta de Superadministración todavía no coincide con una cuenta de Supabase Auth.",
  d1_integrity_and_file_objects_not_verified: "Falta verificar todas las relaciones, identificadores y archivos originales antes de migrar.",
  supabase_school_tables_not_empty: "Hay registros escolares existentes en las tablas de destino.",
  supabase_profiles_do_not_match_auth_users: "Los perfiles de Supabase no coinciden con sus cuentas Auth.",
};

function labelFor(key: string) {
  if (countLabels[key]) return countLabels[key];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Registros";
}

function safeText(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "correo oculto")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "identificador oculto")
    .slice(0, 240);
}

function flattenCounts(tree: CountTree, prefix = ""): Array<{ key: string; label: string; value: number }> {
  const output: Array<{ key: string; label: string; value: number }> = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      output.push({ key: path, label: labelFor(key), value });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      output.push(...flattenCounts(value, path));
    }
  }
  return output;
}

function getMissingAuthCount(value: PreflightResult["missingAuth"]) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && typeof value.count === "number") return value.count;
  return undefined;
}

function formatBlocker(item: Blocker) {
  if (typeof item === "string") return safeText(item);
  if (item.message) return safeText(item.message);
  if (item.code && blockerLabels[item.code]) return `${blockerLabels[item.code]}${item.count === undefined ? "" : ` (cantidad: ${item.count})`}`;
  if (item.code) return labelFor(item.code);
  return item.count === undefined ? "Hay un requisito pendiente." : `Hay ${item.count} requisito(s) pendiente(s).`;
}

export function MigrationPreflightPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PreflightResult | null>(null);

  async function runPreflight() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/supabase-migration/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const payload = await response.json() as PreflightResult;
      if (!response.ok) throw new Error(payload.error || "No se pudo preparar la revisión. Inténtalo de nuevo más tarde.");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? safeText(cause.message) : "No se pudo preparar la revisión. Inténtalo de nuevo más tarde.");
    } finally {
      setBusy(false);
    }
  }

  const sourceCounts = result?.source ? flattenCounts({ accounts: result.source.accounts, ...(result.source.tables ? { tablas: result.source.tables } : {}) }) : [];
  const destinationCounts = result?.destination ? flattenCounts({ authUsers: result.destination.authUsers, ...(result.destination.tables ? { tablas: result.destination.tables } : {}) }) : [];
  const accountCounts = result?.accountMatches ? flattenCounts(result.accountMatches) : [];
  const extraCounts = result?.counts ? flattenCounts(result.counts) : [];
  const missingAuthCount = getMissingAuthCount(result?.missingAuth);
  const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
  const ready = result?.ready ?? (blockers.length === 0 && (missingAuthCount ?? 0) === 0);

  return <section className="portal-panel migration-preflight" aria-labelledby="migration-preflight-title">
    <div className="migration-preflight-heading">
      <div>
        <p className="eyebrow">REVISIÓN DE SOLO LECTURA</p>
        <h2 id="migration-preflight-title">Preparación de Supabase</h2>
      </div>
      <span className="migration-readonly-badge">Sin importar datos</span>
    </div>
    <p>Consulta si las cuentas y los datos actuales pueden prepararse para Supabase. Esta revisión no crea, modifica ni elimina registros y no copia archivos.</p>
    <div className="migration-preflight-actions">
      <button type="button" className="migration-preflight-button" onClick={runPreflight} disabled={busy}>
        {busy ? "Revisando…" : result ? "Volver a revisar" : "Revisar preparación"}
      </button>
      <span>Solo Superadministración puede ejecutar esta consulta.</span>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="migration-preflight-result" aria-live="polite">
      <div className={`migration-result-state ${ready ? "is-ready" : "has-blockers"}`}>
        <span aria-hidden="true">{ready ? "✓" : "!"}</span>
        <div>
          <strong>{ready ? "Revisión sin pendientes reportados" : "Hay puntos que resolver antes de migrar"}</strong>
          <p>{ready ? "El resultado solo confirma que esta consulta no encontró bloqueos." : "Consulta los pendientes y completa la configuración necesaria."}</p>
        </div>
      </div>

      {sourceCounts.length > 0 && <CountGroup title="Datos actuales del portal" items={sourceCounts} />}
      {destinationCounts.length > 0 && <CountGroup title="Datos que ya existen en Supabase" items={destinationCounts} />}
      {accountCounts.length > 0 && <CountGroup title="Revisión de cuentas" items={accountCounts} />}
      {(extraCounts.length > 0 || missingAuthCount !== undefined) && <CountGroup title="Conteos adicionales" items={[...extraCounts, ...(missingAuthCount === undefined ? [] : [{ key: "missingAuth", label: "Cuentas pendientes en Supabase Auth", value: missingAuthCount }])]} />}

      {blockers.length > 0 && <div className="migration-blockers">
        <h3>Pendientes encontrados</h3>
        <ul>{blockers.map((item, index) => <li key={`${index}-${typeof item === "string" ? item : item.code ?? item.message ?? "pendiente"}`}>{formatBlocker(item)}</li>)}</ul>
      </div>}
      {result.status && <p className="migration-status-detail">Estado reportado: {safeText(result.status)}</p>}
      <p className="migration-preflight-footnote">La importación de registros y archivos todavía no se realiza. Revisa y respalda los datos antes de planear un cambio de plataforma.</p>
    </div>}
  </section>;
}

function CountGroup({ title, items }: { title: string; items: Array<{ key: string; label: string; value: number }> }) {
  return <section className="migration-count-group" aria-label={title}>
    <h3>{title}</h3>
    <div className="migration-count-grid">
      {items.map(item => <div className="migration-count-card" key={item.key}><span>{item.label}</span><strong>{item.value}</strong></div>)}
    </div>
  </section>;
}
