import { libraryPreviewKind } from "./library-query.ts";

/** Fetch authenticated bytes from the private file route. A blob URL is created
 * by the mounted preview component and revoked on close; no signed/public URL
 * or bearer credential is returned to the browser. */
export async function loadPrivateLibraryPreview(fileId: string, mimeType: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId) || !libraryPreviewKind(mimeType)) {
    throw new Error("Este formato no tiene vista previa. Puedes descargarlo.");
  }
  const response = await fetcher(`/api/files/${encodeURIComponent(fileId)}`, {
    cache: "no-store", credentials: "same-origin", signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión para abrir el recurso.");
    if (response.status === 403 || response.status === 404) throw new Error("El recurso ya no está disponible para tu cuenta.");
    throw new Error("No se pudo abrir el recurso. Inténtalo de nuevo en unos minutos.");
  }
  const receivedType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (receivedType !== mimeType) throw new Error("El formato del archivo cambió. Actualiza la biblioteca antes de abrirlo.");
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException("Preview closed", "AbortError");
  if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error("Este archivo no se puede mostrar aquí. Puedes descargarlo.");
  return blob;
}
