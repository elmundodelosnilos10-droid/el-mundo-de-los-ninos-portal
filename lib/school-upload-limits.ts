/** New uploads through a hosting function; existing private downloads keep their storage limits. */
export const SCHOOL_UPLOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const SCHOOL_UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const SCHOOL_UPLOAD_MAX_BODY_BYTES = SCHOOL_UPLOAD_MAX_FILE_BYTES + SCHOOL_UPLOAD_MULTIPART_OVERHEAD_BYTES;
export const SCHOOL_UPLOAD_LIMIT_LABEL = "4 MB";
export const SCHOOL_UPLOAD_SIZE_MESSAGE = "El archivo supera el tamaño permitido: hasta 4 MB por archivo.";
export const SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE = "La carga de archivos está pendiente de habilitación por la escuela.";

/** Vercel can reject a request before the Route Handler, with a non-JSON 413. */
export async function readSchoolUploadResponse(response: Response): Promise<unknown> {
  if (response.status === 413) throw new Error(SCHOOL_UPLOAD_SIZE_MESSAGE);
  try { return await response.json(); }
  catch { throw new Error("No se pudo confirmar la carga del archivo. Inténtalo de nuevo."); }
}
