import { createSchoolStorageClient, SupabaseStorageError } from "./supabase/storage.ts";

const SUPABASE_KEY_PREFIX = "supabase:";
const PRIVATE_KEY_PREFIX = "private/";

type FilePurpose = "material" | "submission" | "message";

/** Each stored key identifies its backend, so old R2 files remain reachable
 * after the runtime destination changes for new uploads. */
export function newFileObjectKey(environment: Cloudflare.Env, purpose: FilePurpose) {
  const key = `${PRIVATE_KEY_PREFIX}${purpose}/${crypto.randomUUID()}`;
  return environment.SCHOOL_FILE_STORAGE_PROVIDER === "supabase" ? `${SUPABASE_KEY_PREFIX}${key}` : key;
}

export function isFileStorageConfigured(environment: Cloudflare.Env, objectKey?: string) {
  const storageIsSupabase = objectKey
    ? objectKey.startsWith(SUPABASE_KEY_PREFIX)
    : environment.SCHOOL_FILE_STORAGE_PROVIDER === "supabase";
  if (storageIsSupabase) {
    return Boolean(environment.SUPABASE_URL && environment.SUPABASE_SECRET_KEY);
  }
  return Boolean(environment.BUCKET);
}

export async function putSchoolFile(
  environment: Cloudflare.Env,
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
  fileId: string,
) {
  const supabaseKey = getSupabaseObjectKey(objectKey);
  if (supabaseKey !== null) {
    await createSchoolStorageClient(environment).upload(supabaseKey, bytes, { contentType, maxBytes: bytes.length });
    return;
  }
  if (!environment.BUCKET) throw new Error("School file storage is not configured.");
  await environment.BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType, cacheControl: "private, no-store" },
    customMetadata: { fileId },
  });
}

export async function getSchoolFile(environment: Cloudflare.Env, objectKey: string) {
  const supabaseKey = getSupabaseObjectKey(objectKey);
  if (supabaseKey !== null) {
    try {
      const object = await createSchoolStorageClient(environment).download(supabaseKey);
      return { body: object.body, contentType: object.contentType, sizeBytes: object.sizeBytes };
    } catch (error) {
      if (error instanceof SupabaseStorageError && error.status === 404) return null;
      throw error;
    }
  }
  if (!environment.BUCKET) throw new Error("School file storage is not configured.");
  const object = await environment.BUCKET.get(objectKey);
  return object ? {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    sizeBytes: object.size,
  } : null;
}

/** Read into memory only for the material-delete compensation path, where the
 * existing API restores a removed object if its database transaction fails. */
export async function readSchoolFile(environment: Cloudflare.Env, objectKey: string) {
  const object = await getSchoolFile(environment, objectKey);
  if (!object) return null;
  if (!object.body) return { bytes: new Uint8Array(), contentType: object.contentType };
  return { bytes: new Uint8Array(await new Response(object.body).arrayBuffer()), contentType: object.contentType };
}

export async function deleteSchoolFile(environment: Cloudflare.Env, objectKey: string) {
  const supabaseKey = getSupabaseObjectKey(objectKey);
  if (supabaseKey !== null) {
    await createSchoolStorageClient(environment).remove(supabaseKey);
    return;
  }
  if (!environment.BUCKET) throw new Error("School file storage is not configured.");
  await environment.BUCKET.delete(objectKey);
}

function getSupabaseObjectKey(objectKey: string) {
  if (objectKey.startsWith(SUPABASE_KEY_PREFIX)) {
    const key = objectKey.slice(SUPABASE_KEY_PREFIX.length);
    if (!key.startsWith(PRIVATE_KEY_PREFIX)) throw new Error("Invalid Supabase object key.");
    return key;
  }
  if (!objectKey.startsWith(PRIVATE_KEY_PREFIX)) throw new Error("Invalid school object key.");
  return null;
}
