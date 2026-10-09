import fs from "node:fs";
import path from "node:path";

export class LocalRealtimeTestError extends Error {
  constructor(code) { super(code); this.name = "LocalRealtimeTestError"; this.code = code; }
}
const fail = code => { throw new LocalRealtimeTestError(code); };
const REQUIRED_ACK = "I_ACCEPT_SYNTHETIC_LOOPBACK_ONLY";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);

export function assertLoopbackUrl(value, protocols = ["http:"]) {
  if (typeof value !== "string" || /[\s\r\n]/.test(value) || !/^(?:(http|ws):\/\/(127\.0\.0\.1|\[::1\])|(postgres|postgresql):\/\/postgres:[^@]+@(127\.0\.0\.1|\[::1\])):\d+(\/|$)/.test(value)) fail("non_loopback_url");
  let url; try { url = new URL(value); } catch { fail("invalid_local_url"); }
  if (!LOOPBACK.has(url.hostname) || !protocols.includes(url.protocol) || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535 || url.search || url.hash) fail("invalid_local_url");
  if (protocols.some(protocol => protocol.startsWith("postgres"))) {
    let password; try { password = decodeURIComponent(url.password); } catch { fail("invalid_local_database_credentials"); }
    if (url.username !== "postgres" || typeof password !== "string" || password.length < 1 || password.length > 256 || /[\s\r\n]/.test(password) || url.pathname !== "/postgres") fail("invalid_local_database_credentials");
  } else if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) fail("invalid_local_url");
  return url;
}
export function localConfiguration(environment) {
  // Deliberately accesses only these four dedicated variables, not project env.
  const ack = environment.SCHOOL_REALTIME_TEST_ALLOW_LOCAL_WRITES;
  const api = environment.SCHOOL_REALTIME_TEST_API_URL;
  const database = environment.SCHOOL_REALTIME_TEST_DATABASE_URL;
  const credentialsFile = environment.SCHOOL_REALTIME_TEST_CREDENTIALS_FILE;
  if (!ack && !api && !database && !credentialsFile) fail("not_configured");
  if (ack !== REQUIRED_ACK) fail("local_writes_not_acknowledged");
  const apiUrl = assertLoopbackUrl(api);
  const databaseUrl = assertLoopbackUrl(database, ["postgres:", "postgresql:"]);
  if (!path.isAbsolute(credentialsFile ?? "") || !/^school-realtime-local-credentials\.[A-Za-z0-9_-]+\.json$/.test(path.basename(credentialsFile))) fail("invalid_credentials_file");
  return { apiUrl: apiUrl.origin, databaseUrl: databaseUrl.href, credentialsFile };
}
function jwtClaims(value) {
  if (typeof value !== "string" || value.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) fail("invalid_local_key");
  try { return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")); }
  catch { fail("invalid_local_key"); }
}
export function validateLocalCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "anonKey,serviceRoleKey") fail("invalid_local_credentials");
  for (const [field, role] of [["anonKey", "anon"], ["serviceRoleKey", "service_role"]]) {
    const claims = jwtClaims(value[field]);
    if (claims?.iss !== "supabase-demo" || claims?.role !== role || !Number.isFinite(claims?.exp) || claims.exp * 1000 <= Date.now()) fail("non_local_credentials");
  }
  return { anonKey: value.anonKey, serviceRoleKey: value.serviceRoleKey };
}
export function readLocalCredentials(filename) {
  if (!path.isAbsolute(filename ?? "") || !/^school-realtime-local-credentials\.[A-Za-z0-9_-]+\.json$/.test(path.basename(filename))) fail("invalid_credentials_file");
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size < 1 || stat.size > 20000) fail("unsafe_credentials_file");
    const bytes = Buffer.alloc(20001);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 20000) fail("unsafe_credentials_file");
    let payload; try { payload = JSON.parse(bytes.subarray(0, length).toString("utf8")); } catch { fail("invalid_local_credentials"); }
    return validateLocalCredentials(payload);
  } catch (error) {
    if (error instanceof LocalRealtimeTestError) throw error;
    fail("unsafe_credentials_file");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function assertSyntheticUser(user) {
  if (!user || !UUID.test(user.id ?? "") || typeof user.email !== "string" || !/^realtime-local-[a-f0-9]{12}-(teacher|family-a|family-b)@example\.com$/.test(user.email)) fail("non_synthetic_user");
  return user;
}
export function assertLocalUserSession(session, expectedUser, apiUrl) {
  assertSyntheticUser(expectedUser);
  const claims = jwtClaims(session?.access_token);
  if (session?.user?.id !== expectedUser.id || session?.user?.email !== expectedUser.email || claims.sub !== expectedUser.id || claims.role !== "authenticated" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) fail("invalid_local_session");
  let issuer; try { issuer = new URL(claims.iss); } catch { fail("non_local_session"); }
  if (!LOOPBACK.has(issuer.hostname) || issuer.origin !== apiUrl || issuer.pathname !== "/auth/v1") fail("non_local_session");
  return session;
}

export function assertLocalTransportUrl(value, origins, protocol) {
  let url; try { url = new URL(String(value)); } catch { fail("external_transport_blocked"); }
  if (!new RegExp(`^${protocol.slice(0,-1)}://(127\\.0\\.0\\.1|\\[::1\\]):\\d+/`).test(String(value)) ||
    url.protocol !== protocol || !LOOPBACK.has(url.hostname) || url.username || url.password || url.hash ||
    !origins.has(url.origin.replace(/^ws:/,"http:"))) fail("external_transport_blocked");
  return url;
}
export function assertSafeSseEnvelope(event, data) {
  if (!data || typeof data!=="object" || Array.isArray(data)) fail("private_sse_content");
  const keys=Object.keys(data);
  if(event==="ready" && keys.length===0)return;
  if(event==="end" && keys.length===1 && ["rotate","unavailable","unauthorized"].includes(data.reason))return;
  if(event==="invalidate" && keys.length===1 && ["all","notifications","communication"].includes(data.scope))return;
  if(event==="invalidate" && keys.length===2 && data.scope==="messages" && UUID.test(data.conversationId??""))return;
  fail("private_sse_content");
}
