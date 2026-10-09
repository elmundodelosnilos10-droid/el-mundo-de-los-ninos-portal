import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const ISOLATED_ACK = 'empty-disposable-stack';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Literal IPs prevent DNS/hosts-file resolution and URL-parser shorthand from
// making an apparently local destination reach another host.
export function loopbackOrigin(value, label) {
  if (typeof value !== 'string' || !/^http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/?$/.test(value)) {
    throw new Error(`${label}: se requiere http://127.0.0.1:puerto o http://[::1]:puerto.`);
  }
  const url = new URL(value);
  if (Number(value.match(/:(\d+)\/?$/)[1]) > 65535) throw new Error(`${label}: puerto no válido.`);
  return url.origin;
}

export function localConfig(env) {
  if (env.LOCAL_SCHOOL_HTTP_ISOLATED !== ISOLATED_ACK) throw new Error('Confirma un stack local vacío y desechable con LOCAL_SCHOOL_HTTP_ISOLATED.');
  const appOrigin = loopbackOrigin(env.LOCAL_SCHOOL_HTTP_APP_URL, 'App');
  const supabaseOrigin = loopbackOrigin(env.LOCAL_SCHOOL_HTTP_SUPABASE_URL, 'Supabase');
  if (appOrigin === supabaseOrigin) throw new Error('App y Supabase deben usar orígenes diferentes.');
  const credentialsFile = env.LOCAL_SCHOOL_HTTP_CREDENTIALS_FILE;
  if (!credentialsFile || basename(credentialsFile) !== 'school-http-local-credentials.json' || !credentialsFile.startsWith('/')) {
    throw new Error('Se requiere archivo absoluto dedicado school-http-local-credentials.json; no se leen archivos de entorno.');
  }
  const evidenceFile = env.LOCAL_SCHOOL_HTTP_EVIDENCE_FILE;
  if (!evidenceFile?.startsWith('/') || !evidenceFile.endsWith('.json') || evidenceFile === credentialsFile) {
    throw new Error('Se requiere una ruta absoluta .json separada para evidencia.');
  }
  return { appOrigin, supabaseOrigin, credentialsFile, evidenceFile };
}

export async function localCredentials(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) {
    throw new Error('El archivo de claves locales debe ser regular, máximo16KiB y permisos0600.');
  }
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('El archivo dedicado de claves locales no es JSON válido.'); }
  if (!value || Object.keys(value).sort().join(',') !== 'anonKey,serviceRoleKey'
      || typeof value.anonKey !== 'string' || !value.anonKey
      || typeof value.serviceRoleKey !== 'string' || !value.serviceRoleKey
      || value.anonKey === value.serviceRoleKey) throw new Error('El archivo dedicado necesita anonKey y serviceRoleKey locales diferentes.');
  return value;
}

export function requiredId(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label}: respuesta sin UUID válido.`);
  return value;
}

export function items(value, label) {
  if (!value || !Array.isArray(value.items)) throw new Error(`${label}: respuesta sin lista válida.`);
  return value.items;
}

export class LocalHttp {
  constructor({ appOrigin, supabaseOrigin, fetchImpl = fetch, timeoutMs = 30000, evidence = [] }) {
    this.appOrigin = loopbackOrigin(appOrigin, 'App');
    this.supabaseOrigin = loopbackOrigin(supabaseOrigin, 'Supabase');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.evidence = evidence;
  }

  async request(target, path, { method = 'GET', body, headers = {}, jar, statuses = [200], label = 'HTTP' } = {}) {
    const origin = target === 'app' ? this.appOrigin : target === 'supabase' ? this.supabaseOrigin : null;
    if (!origin || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new Error('Destino local no válido.');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('Destino local no válido.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    const event = { label, target, method, path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'), status: null, elapsedMs: 0, result: 'failed', mutationOutcome: method === 'GET' ? 'read-only' : 'uncertain' };
    let failure = 'network-or-timeout';
    try {
      const response = await this.fetchImpl(url, {
        method, redirect: 'manual', signal: controller.signal,
        headers: { ...(target === 'app' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(jar?.size ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      event.status = response.status;
      if (response.status >= 300 && response.status < 400) { failure = 'redirect-rejected'; throw new Error(); }
      if (!statuses.includes(response.status)) { failure = 'unexpected-status'; throw new Error(); }
      const reader = response.body?.getReader();
      const chunks = []; let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); failure = 'response-too-large'; throw new Error(); }
          chunks.push(value);
        }
      }
      let data = null;
      if (size) {
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { failure = 'invalid-json'; throw new Error(); }
      }
      if (jar && target === 'app') {
        for (const cookie of response.headers.getSetCookie()) {
          const entry = cookie.split(';', 1)[0]; const equals = entry.indexOf('=');
          if (equals < 1) continue;
          const key = entry.slice(0, equals); const value = entry.slice(equals + 1);
          if (!value || /;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(key); else jar.set(key, value);
        }
      }
      event.result = 'passed'; event.mutationOutcome = method === 'GET' ? 'read-only' : 'response-confirmed';
      return data;
    } catch {
      event.failure = failure;
      // Never include response bodies, thrown fetch errors, URL queries,
      // credentials, cookies or Auth payloads in diagnostics/evidence.
      throw new Error(`${label}: ${method} ${event.path} falló (${failure}${event.status === null ? '' : `; HTTP${event.status}`}). No se reintentó.`);
    } finally {
      clearTimeout(timer); event.elapsedMs = Date.now() - started; this.evidence.push(event);
    }
  }
}

export async function requireEmptyLocalStack(http, adminHeaders) {
  const identities = await http.request('supabase', '/auth/v1/admin/users?page=1&per_page=1', { headers: adminHeaders, label: 'Preflight Auth vacío' });
  if (!Array.isArray(identities?.users) || identities.users.length) throw new Error('Supabase local contiene identidades o no permite comprobarlas; no se escribió ninguna cuenta.');
  for (const table of ['profiles', 'user_roles', 'students', 'school_years', 'groups', 'teachers', 'guardians']) {
    const rows = await http.request('supabase', `/rest/v1/${table}?select=*&limit=1`, { headers: adminHeaders, label: `Preflight ${table} vacío` });
    if (!Array.isArray(rows) || rows.length) throw new Error(`Supabase local no está vacío (${table}); usa un stack desechable nuevo.`);
  }
}
