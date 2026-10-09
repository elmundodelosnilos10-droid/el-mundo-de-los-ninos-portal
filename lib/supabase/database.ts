import { permitsIsolatedSupabaseHttp } from "./local-http-test-policy.ts";

/**
 * Server-only, user-scoped PostgREST client.
 *
 * Every operation requires the current user's JWT and sends it as the
 * Authorization bearer token alongside the project's publishable API key.
 * The module intentionally has no service/secret key support. It exposes a
 * small, validated subset of PostgREST; authorization remains enforced by
 * Supabase RLS policies and callers must still validate their application
 * roles and resource relationships.
 */

export type SupabaseDatabaseEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

export type SupabaseDatabaseConfig = {
  url?: string;
  publishableKey?: string;
};

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in";

export type FilterValue = string | number | boolean | null | readonly (string | number | boolean | null)[];

export type PostgrestFilter = {
  column: string;
  operator: FilterOperator;
  value: FilterValue;
};

export type SelectOptions = {
  columns?: readonly string[] | "*";
  filters?: readonly PostgrestFilter[];
  orderBy?: readonly { column: string; ascending?: boolean }[];
  limit?: number;
  offset?: number;
  count?: "exact" | "planned" | "estimated";
};

export type MutationOptions = {
  returning?: readonly string[] | "*";
};

export type RpcArguments = Record<string, unknown>;

export type SelectResult<T> = { data: T[]; count: number | null };
export type MutationResult<T> = { data: T[] };

export class SupabaseDatabaseError extends Error {
  readonly code: "not_configured" | "invalid_input" | "rejected" | "unavailable";
  readonly operation: "select" | "insert" | "update" | "delete" | "rpc";
  readonly status?: number;

  constructor(
    code: SupabaseDatabaseError["code"],
    operation: SupabaseDatabaseError["operation"],
    status?: number,
  ) {
    super(`Supabase database ${operation} failed (${code})`);
    this.name = "SupabaseDatabaseError";
    this.code = code;
    this.operation = operation;
    this.status = status;
  }
}

const MAX_LIMIT = 500;
const MAX_OFFSET = 100_000;
const MAX_FILTERS = 32;
const MAX_IN_VALUES = 100;
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPERATORS = new Set<FilterOperator>(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);

/** Build a client from server-only environment bindings. */
export function createSchoolDatabaseClient(
  environment: SupabaseDatabaseEnvironment,
  fetcher: typeof fetch = fetch,
) {
  return createSupabaseDatabaseClient({
    url: environment.SUPABASE_URL,
    publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
  }, fetcher);
}

/** Injectable factory for server routes and mock-based tests. */
export function createSupabaseDatabaseClient(
  config: SupabaseDatabaseConfig,
  fetcher: typeof fetch = fetch,
) {
  function requestUserJwt(jwt: string, operation: DatabaseOperation) {
    if (typeof jwt !== "string" || jwt.length < 1 || jwt.length > 16_384 || /[\s\r\n]/.test(jwt)) {
      throw dbError("invalid_input", operation);
    }
    return jwt;
  }

  function getCredentials(jwt: string, operation: DatabaseOperation) {
    const userJwt = requestUserJwt(jwt, operation);
    const publishableKey = config.publishableKey?.trim();
    if (!publishableKey || /[\r\n]/.test(publishableKey)) throw dbError("not_configured", operation);
    const base = safeBaseUrl(config.url, operation);
    return { userJwt, publishableKey, base };
  }

  function tableUrl(base: URL, table: string, operation: DatabaseOperation) {
    if (typeof table !== "string" || !IDENTIFIER.test(table)) throw dbError("invalid_input", operation);
    return new URL(`/rest/v1/${encodeURIComponent(table)}`, base);
  }

  function rpcUrl(base: URL, functionName: string, operation: DatabaseOperation) {
    if (typeof functionName !== "string" || !IDENTIFIER.test(functionName)) throw dbError("invalid_input", operation);
    return new URL(`/rest/v1/rpc/${encodeURIComponent(functionName)}`, base);
  }

  function headers(publishableKey: string, userJwt: string, extra: Record<string, string> = {}) {
    return {
      apikey: publishableKey,
      Authorization: `Bearer ${userJwt}`,
      Accept: "application/json",
      ...extra,
    };
  }

  async function send<T>(
    operation: DatabaseOperation,
    url: URL,
    jwt: string,
    key: string,
    init: {
      method: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
      prefer?: string;
      countRequested?: boolean;
    },
  ): Promise<{ data: T[]; count: number | null }> {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    if (body !== undefined && new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) {
      throw dbError("invalid_input", operation);
    }
    const extraHeaders: Record<string, string> = {};
    if (body !== undefined) extraHeaders["Content-Type"] = "application/json";
    if (init.prefer) extraHeaders.Prefer = init.prefer;
    if (init.countRequested) extraHeaders["Range-Unit"] = "items";

    let response: Response;
    try {
      response = await fetcher(url, {
        method: init.method,
        headers: headers(key, jwt, extraHeaders),
        ...(body === undefined ? {} : { body }),
        redirect: "error",
      });
    } catch {
      throw dbError("unavailable", operation);
    }
    if (!response.ok) throw dbError("rejected", operation, await rejectedRpcStatus(response, operation));

    const count = init.countRequested ? parseContentRange(response.headers.get("content-range")) : null;
    if (response.status === 204 || response.status === 205) return { data: [], count };
    const responseText = await response.text().catch(() => null);
    if (responseText === null) throw dbError("rejected", operation, 502);
    if (responseText.trim() === "" && init.prefer?.includes("return=minimal")) return { data: [], count };
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw dbError("rejected", operation, 502);
    }
    if (payload === null) throw dbError("rejected", operation, 502);
    if (Array.isArray(payload)) return { data: payload as T[], count };
    if (typeof payload === "object") return { data: [payload as T], count };
    throw dbError("rejected", operation, 502);
  }

  async function select<T extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
    table: string,
    options: SelectOptions = {},
  ): Promise<SelectResult<T>> {
    const operation = "select" as const;
    const { base, publishableKey, userJwt } = getCredentials(jwt, operation);
    const url = tableUrl(base, table, operation);
    url.searchParams.set("select", encodeColumns(options.columns ?? "*", operation));
    appendFilters(url, options.filters ?? [], operation);
    appendOrder(url, options.orderBy ?? [], operation);
    const { limit, offset } = validatePage(options.limit, options.offset, operation);
    url.searchParams.set("limit", String(limit));
    if (offset > 0) url.searchParams.set("offset", String(offset));
    const countRequested = options.count !== undefined;
    if (options.count !== undefined) {
      if (!new Set(["exact", "planned", "estimated"]).has(options.count)) throw dbError("invalid_input", operation);
    }
    const result = await send<T>(operation, url, userJwt, publishableKey, {
      method: "GET",
      ...(options.count === undefined ? {} : { prefer: `count=${options.count}` }),
      countRequested,
    });
    return result;
  }

  async function insert<T extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
    table: string,
    rows: Record<string, unknown> | readonly Record<string, unknown>[],
    options: MutationOptions = {},
  ): Promise<MutationResult<T>> {
    const operation = "insert" as const;
    const { base, publishableKey, userJwt } = getCredentials(jwt, operation);
    const url = tableUrl(base, table, operation);
    const prefer = applyReturning(url, options.returning, operation);
    const normalizedRows = Array.isArray(rows) ? rows : [rows];
    validateRows(normalizedRows, operation);
    const result = await send<T>(operation, url, userJwt, publishableKey, {
      method: "POST",
      body: normalizedRows,
      prefer,
    });
    return { data: result.data };
  }

  async function update<T extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
    table: string,
    values: Record<string, unknown>,
    filters: readonly PostgrestFilter[],
    options: MutationOptions = {},
  ): Promise<MutationResult<T>> {
    const operation = "update" as const;
    const { base, publishableKey, userJwt } = getCredentials(jwt, operation);
    const url = tableUrl(base, table, operation);
    requireMutationFilters(filters, operation);
    appendFilters(url, filters, operation);
    const prefer = applyReturning(url, options.returning, operation);
    validateRow(values, operation);
    const result = await send<T>(operation, url, userJwt, publishableKey, {
      method: "PATCH",
      body: values,
      prefer,
    });
    return { data: result.data };
  }

  async function remove<T extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
    table: string,
    filters: readonly PostgrestFilter[],
    options: MutationOptions = {},
  ): Promise<MutationResult<T>> {
    const operation = "delete" as const;
    const { base, publishableKey, userJwt } = getCredentials(jwt, operation);
    const url = tableUrl(base, table, operation);
    requireMutationFilters(filters, operation);
    appendFilters(url, filters, operation);
    const prefer = applyReturning(url, options.returning, operation);
    const result = await send<T>(operation, url, userJwt, publishableKey, {
      method: "DELETE",
      prefer,
    });
    return { data: result.data };
  }

  async function rpc<T extends Record<string, unknown> = Record<string, unknown>>(
    jwt: string,
    functionName: string,
    args: RpcArguments,
  ): Promise<MutationResult<T>> {
    const operation = "rpc" as const;
    const { base, publishableKey, userJwt } = getCredentials(jwt, operation);
    const url = rpcUrl(base, functionName, operation);
    // PostgreSQL functions with no parameters use an empty JSON object.
    // Column mutations still require a nonempty row through validateRow.
    if (!args || typeof args !== "object" || Array.isArray(args) ||
        Object.keys(args).some(key => !IDENTIFIER.test(key))) throw dbError("invalid_input", operation);
    const result = await send<T>(operation, url, userJwt, publishableKey, {
      method: "POST",
      body: args,
      prefer: "return=representation",
    });
    return { data: result.data };
  }

  return { select, insert, update, remove, rpc };
}

type DatabaseOperation = "select" | "insert" | "update" | "delete" | "rpc";

function dbError(code: SupabaseDatabaseError["code"], operation: DatabaseOperation, status?: number) {
  return new SupabaseDatabaseError(code, operation, status);
}

/** PostgREST maps PL/pgSQL P0002 to HTTP500. School RPCs deliberately use
 * that SQLSTATE for an unavailable/foreign resource; route contracts use404.
 * Interpret only this exact code on RPC500 JSON; never retain reason/details.
 */
async function rejectedRpcStatus(response: Response, operation: DatabaseOperation) {
  if (operation !== "rpc" || response.status !== 500
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return response.status;
  const reader = response.body?.getReader();
  if (!reader) return response.status;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>(resolve => {
    timer = setTimeout(() => resolve(response.status), 2000);
  });
  const read = (async () => {
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16 * 1024) return response.status;
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      && "code" in parsed && parsed.code === "P0002" ? 404 : response.status;
  })().catch(() => response.status);
  try { return await Promise.race([read, timeout]); }
  finally {
    if (timer) clearTimeout(timer);
    // Cancel any stalled/oversized stream without blocking on its cancellation.
    void reader.cancel().then(() => reader.releaseLock()).catch(() => undefined);
  }
}

function safeBaseUrl(value: string | undefined, operation: DatabaseOperation) {
  if (!value) throw dbError("not_configured", operation);
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && !permitsIsolatedSupabaseHttp(value)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("bad URL");
    return url;
  } catch {
    throw dbError("not_configured", operation);
  }
}

function encodeColumns(value: readonly string[] | "*", operation: DatabaseOperation) {
  if (value === "*") return "*";
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some(column => column !== "*" && !IDENTIFIER.test(column))) {
    throw dbError("invalid_input", operation);
  }
  return value.join(",");
}

function applyReturning(url: URL, returning: MutationOptions["returning"], operation: DatabaseOperation) {
  if (returning === undefined) return "return=minimal";
  url.searchParams.set("select", encodeColumns(returning, operation));
  return "return=representation";
}

function appendFilters(url: URL, filters: readonly PostgrestFilter[], operation: DatabaseOperation) {
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) throw dbError("invalid_input", operation);
  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || !IDENTIFIER.test(filter.column) || !OPERATORS.has(filter.operator)) {
      throw dbError("invalid_input", operation);
    }
    url.searchParams.append(filter.column, `${filter.operator}.${encodeFilterValue(filter.operator, filter.value, operation)}`);
  }
}

function encodeFilterValue(operator: FilterOperator, value: FilterValue, operation: DatabaseOperation): string {
  if (operator === "in") {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IN_VALUES) throw dbError("invalid_input", operation);
    return `(${value.map(item => quoteScalar(item, true, operation)).join(",")})`;
  }
  if (Array.isArray(value)) throw dbError("invalid_input", operation);
  if (operator === "is" && value !== null && typeof value !== "boolean") throw dbError("invalid_input", operation);
  if ((operator === "like" || operator === "ilike") && typeof value !== "string") throw dbError("invalid_input", operation);
  return quoteScalar(value as string | number | boolean | null, false, operation);
}

function quoteScalar(value: string | number | boolean | null, forceStringQuote: boolean, operation: DatabaseOperation) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw dbError("invalid_input", operation);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw dbError("invalid_input", operation);
  if (!forceStringQuote && !/[(),.:"]/.test(value) && !value.includes("\\")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function appendOrder(url: URL, orderBy: SelectOptions["orderBy"], operation: DatabaseOperation) {
  if (!Array.isArray(orderBy) || orderBy.length > 16) throw dbError("invalid_input", operation);
  if (!orderBy.length) return;
  const order = orderBy.map(item => {
    if (!item || !IDENTIFIER.test(item.column) || (item.ascending !== undefined && typeof item.ascending !== "boolean")) {
      throw dbError("invalid_input", operation);
    }
    return `${item.column}.${item.ascending === false ? "desc" : "asc"}`;
  });
  url.searchParams.set("order", order.join(","));
}

function validatePage(limit: number | undefined, offset: number | undefined, operation: DatabaseOperation) {
  const pageLimit = limit ?? 100;
  const pageOffset = offset ?? 0;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_LIMIT ||
      !Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > MAX_OFFSET) {
    throw dbError("invalid_input", operation);
  }
  return { limit: pageLimit, offset: pageOffset };
}

function validateRow(value: unknown, operation: DatabaseOperation): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length < 1 ||
      Object.keys(value).some(key => !IDENTIFIER.test(key))) throw dbError("invalid_input", operation);
}

function validateRows(values: readonly Record<string, unknown>[], operation: DatabaseOperation) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 500) throw dbError("invalid_input", operation);
  for (const value of values) validateRow(value, operation);
}

function requireMutationFilters(filters: readonly PostgrestFilter[], operation: "update" | "delete") {
  if (!Array.isArray(filters) || filters.length === 0) throw dbError("invalid_input", operation);
}

function parseContentRange(value: string | null): number | null {
  if (!value) return null;
  const match = /^(?:\d+-\d+|\*)\/(\d+|\*)$/.exec(value.trim());
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : null;
}
