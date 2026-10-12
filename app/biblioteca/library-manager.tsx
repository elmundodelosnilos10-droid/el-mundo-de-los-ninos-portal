"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { libraryListUrl, libraryPreviewKind, type LibraryFeed, type LibraryMaterial } from "@/lib/library-query";
import { readSchoolUploadResponse, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE } from "@/lib/school-upload-limits";
import { LibraryPreview } from "./library-preview";
import styles from "./library.module.css";

type Group = { id: string; name: string };
type Material = LibraryMaterial;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_MESSAGE = "Tu sesión o tus permisos cambiaron. Vuelve a iniciar sesión para consultar los recursos.";
const UNKNOWN_WRITE_MESSAGE = "No se pudo confirmar la operación. Consulta los recursos antes de volver a intentarla.";
const KNOWN_UPLOAD_ERRORS = new Set([
  "El tamaño de la solicitud no es válido.", "No se recibió un archivo válido.", "Selecciona un archivo.", "Selecciona el archivo nuevo.",
  "Se permiten imágenes JPG, PNG, WebP, documentos PDF y audios MP3, OGG o WAV.", "Se permiten imágenes JPG, PNG, WebP, PDF y audios MP3, OGG o WAV.",
  "Revisa el grupo, el título y la categoría.", "El contenido del archivo no coincide con su tipo.",
  "La imagen está dañada o no se pudo quitar su información privada.", "El archivo no superó la revisión de seguridad.",
  "El archivo nuevo no cumple los requisitos.", SCHOOL_UPLOAD_SIZE_MESSAGE,
]);
const safeName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").slice(0, 160) || "archivo";
const validFileReceipt = (payload: Record<string, unknown>, file: File) => payload.name === safeName(file.name) && Number.isSafeInteger(payload.sizeBytes) &&
  Number(payload.sizeBytes) > 0 && (file.type.startsWith("image/") ? Number(payload.sizeBytes) <= file.size : payload.sizeBytes === file.size);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function validFeed(data: Record<string, unknown>, page: number, pageSize: number): data is Record<string, unknown> & LibraryFeed {
  return data.page === page && data.pageSize === pageSize && Number.isSafeInteger(data.total) && Number(data.total) >= 0 &&
    Array.isArray(data.categories) && data.categories.every(category => nonempty(category) && category.length <= 60) &&
    Array.isArray(data.items) && data.items.length <= pageSize && data.items.length <= Number(data.total) && data.items.every(value => {
      const item = record(value);
      return [item.id, item.fileId, item.groupId].every(id => typeof id === "string" && UUID.test(id)) &&
        [item.groupName, item.title, item.category, item.fileName, item.mimeType, item.publishedAt].every(nonempty) &&
        Number.isSafeInteger(item.sizeBytes) && Number(item.sizeBytes) > 0;
    });
}

export function LibraryManager({ groups, canUpload, uploadsReady = false }: { groups: Group[]; canUpload: boolean; uploadsReady?: boolean }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [result, setResult] = useState<{ key: string; feed: LibraryFeed | null; error: string }>({ key: "", feed: null, error: "" });
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const pageSize = 12;
  const listUrl = libraryListUrl({ query, groupId: groupFilter || null, category: categoryFilter || null, page, pageSize });
  const scope = `${canUpload}:${uploadsReady}:${groups.map(group => group.id).join(",")}`;
  const requestKey = `${scope}:${listUrl}:${revision}`;
  const current = useRef({ scope, requestKey, canUpload, uploadsReady });
  useLayoutEffect(() => { current.current = { scope, requestKey, canUpload, uploadsReady }; }, [scope, requestKey, canUpload, uploadsReady]);
  const mounted = useRef(false);
  const access = useRef(true);
  const writeLock = useRef(false);
  const readRequired = useRef(false);
  const listController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const loading = result.key !== requestKey;
  const feed = loading || revoked ? null : result.feed;
  const items = feed?.items ?? [];
  const total = feed?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const categories = feed?.categories ?? [];
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [messageScope, setMessageScope] = useState(scope);
  const previousScope = useRef(scope);
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacementMaterial = useRef<Material | null>(null);

  const writing = busy || Boolean(updatingId);
  const writesDisabled = writing || loading || needsRead || revoked || !feed;

  function refresh() {
    if (!mounted.current || !access.current || writeLock.current) return;
    readRequired.current = true; setNeedsRead(true);
    listController.current?.abort(); setPreviewMaterial(null);
    replacementMaterial.current = null;
    setRevision(current => current + 1);
  }

  function revoke() {
    access.current = false; readRequired.current = true;
    listController.current?.abort(); writeController.current?.abort();
    replacementMaterial.current = null;
    if (!mounted.current) return;
    setRevoked(true); setNeedsRead(true); setPreviewMaterial(null);
    setResult({ key: current.current.requestKey, feed: null, error: "" });
    setError(ACCESS_MESSAGE); setNote(""); setBusy(false); setUpdatingId("");
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listController.current?.abort(); writeController.current?.abort(); replacementMaterial.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    replacementMaterial.current = null;
    // Permission changes hide the old feed synchronously through requestKey;
    // reset transient form state after committing the new scope.
    const changed = previousScope.current !== scope;
    previousScope.current = scope;
    if (changed) Promise.resolve().then(() => {
      if (cancelled || !mounted.current || current.current.scope !== scope) return;
      setPreviewMaterial(null); setError(""); setNote(""); setBusy(false); setUpdatingId("");
      setDraftQuery(""); setQuery(""); setGroupFilter(""); setCategoryFilter(""); setPage(1);
      setMessageScope(scope);
    });
    return () => { cancelled = true; writeController.current?.abort(); writeController.current = null; writeLock.current = false; };
  }, [scope]);

  useEffect(() => {
    if (!access.current) return;
    const controller = new AbortController();
    listController.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const active = () => mounted.current && access.current && !controller.signal.aborted && current.current.requestKey === requestKey;
    fetch(listUrl, { credentials: "same-origin", cache: "no-store", signal }).then(async response => {
      if (!active()) return;
      if (response.status === 401 || response.status === 403) { revoke(); return; }
      if (signal.aborted) throw Error("Tiempo de espera agotado.");
      const data = record(await response.json());
      if (!active()) return;
      if (signal.aborted || response.status !== 200) throw Error("No se cargaron los materiales.");
      if (!validFeed(data, page, pageSize)) throw Error("No se pudo confirmar la lista de materiales.");
      const lastPage = Math.max(1, Math.ceil(Number(data.total) / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      readRequired.current = false; setNeedsRead(false);
      setResult({ key: requestKey, feed: data, error: "" });
    }).catch(() => {
      if (active()) {
        readRequired.current = true; setNeedsRead(true);
        setResult({ key: requestKey, feed: null, error: "No se pudieron consultar los materiales." });
      }
    });
    return () => controller.abort();
  }, [listUrl, requestKey, page]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (writeLock.current || !access.current) return;
    setQuery(draftQuery.trim()); setPage(1); setError(""); setPreviewMaterial(null); refresh();
  }
  function clearFilters() {
    if (writeLock.current || !access.current) return;
    setDraftQuery(""); setQuery(""); setGroupFilter(""); setCategoryFilter(""); setPage(1); setError(""); setPreviewMaterial(null); refresh();
  }

  function changeView(change: () => void) {
    if (writeLock.current || !access.current) return;
    readRequired.current = true; setNeedsRead(true); listController.current?.abort();
    setError(""); setPreviewMaterial(null); replacementMaterial.current = null; change();
  }

  function openPreview(material: Material) {
    if (!mounted.current || !access.current || readRequired.current || writeLock.current || current.current.requestKey !== requestKey || !feed?.items.some(item => item.id === material.id && item.fileId === material.fileId)) return;
    setPreviewMaterial(material);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || !access.current || !current.current.canUpload || scope !== current.current.scope || writeLock.current) return;
    if (!current.current.uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    const form = event.currentTarget;
    const data = new FormData(form); data.set("purpose", "material");
    const file = data.get("file");
    if (file instanceof File && file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    if (!(file instanceof File) || file.size < 1 || !groups.some(group => group.id === data.get("groupId"))) { setError("Selecciona un grupo y un archivo válido."); return; }
    if (!libraryPreviewKind(file.type)) { setError("Se permiten imágenes JPG, PNG, WebP, documentos PDF y audios MP3, OGG o WAV."); return; }
    const title = String(data.get("title") ?? "").trim(), category = String(data.get("category") ?? "").trim();
    if (title.length < 2 || title.length > 120 || category.length < 2 || category.length > 60) { setError("Revisa el grupo, el título y la categoría."); return; }
    await mutate("/api/files", "POST", data, "", payload => typeof payload.id === "string" && UUID.test(payload.id) && validFileReceipt(payload, file),
      () => { form.reset(); setNote("Material publicado para el grupo."); }, 201);
  }

  async function replaceFile(material: Material, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!mounted.current || !access.current || !current.current.canUpload || scope !== current.current.scope || writeLock.current) return;
    if (!current.current.uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    if (file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    if (file.size < 1) { setError("Selecciona un archivo con contenido."); return; }
    if (!libraryPreviewKind(file.type)) { setError("Se permiten imágenes JPG, PNG, WebP, documentos PDF y audios MP3, OGG o WAV."); return; }
    const data = new FormData(); data.set("file", file);
    if (!feed?.items.some(item => item.id === material.id && item.fileId === material.fileId) || current.current.requestKey !== requestKey) return;
    await mutate(`/api/materials/${material.id}/replace`, "POST", data, material.id, payload => payload.id === material.id && payload.fileId === material.fileId && payload.mimeType === file.type && validFileReceipt(payload, file),
      () => setNote(`Se reemplazó el archivo de “${material.title}”.`), 200);
  }

  async function removeMaterial(material: Material) {
    if (!mounted.current || !access.current || !current.current.canUpload || scope !== current.current.scope || writeLock.current || readRequired.current || current.current.requestKey !== requestKey || !feed?.items.some(item => item.id === material.id && item.fileId === material.fileId)) return;
    if (!window.confirm(`¿Retirar “${material.title}” de la biblioteca? Las familias ya no podrán abrir ni descargar este archivo.`)) return;
    await mutate(`/api/materials/${material.id}`, "DELETE", undefined, material.id, payload => payload.ok === true,
      () => setNote(`Se retiró “${material.title}” de la biblioteca.`), 200);
  }

  async function mutate(url: string, method: "POST" | "DELETE", body: FormData | undefined, id: string, valid: (payload: Record<string, unknown>) => boolean, confirmed: () => void, expectedStatus: number) {
    if (writeLock.current || readRequired.current || loading || !feed || !mounted.current || !access.current || !current.current.canUpload || current.current.scope !== scope || current.current.requestKey !== requestKey) return;
    writeLock.current = true;
    const controller = new AbortController(); writeController.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    const active = () => mounted.current && access.current && !controller.signal.aborted && current.current.scope === scope && current.current.canUpload;
    setBusy(!id); setUpdatingId(id); setError(""); setNote(""); setMessageScope(scope);
    try {
      const response = await fetch(url, { method, body, credentials: "same-origin", cache: "no-store", signal });
      if (!active()) return;
      if (response.status === 401 || response.status === 403) { revoke(); return; }
      if (response.status === 413 && !signal.aborted) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
      const payload = record(method === "POST" ? await readSchoolUploadResponse(response) : await response.json());
      if (!active()) return;
      if (!signal.aborted && response.status === 400 && typeof payload.error === "string" && KNOWN_UPLOAD_ERRORS.has(payload.error)) { setError(payload.error); return; }
      if (!signal.aborted && response.status === 404) {
        setPreviewMaterial(null); replacementMaterial.current = null; readRequired.current = true; setNeedsRead(true);
        setResult({ key: requestKey, feed: null, error: "Recurso no disponible. Consulta los recursos para actualizar la biblioteca." });
        return;
      }
      if (signal.aborted || response.status !== expectedStatus || !valid(payload)) throw Error(UNKNOWN_WRITE_MESSAGE);
      confirmed(); setPreviewMaterial(null); replacementMaterial.current = null;
      readRequired.current = true; setNeedsRead(true); listController.current?.abort();
      setRevision(current => current + 1);
    } catch (reason) {
      if (active()) {
        readRequired.current = true; setNeedsRead(true); setPreviewMaterial(null); replacementMaterial.current = null;
        setError(record(reason).message === SCHOOL_UPLOAD_SIZE_MESSAGE ? SCHOOL_UPLOAD_SIZE_MESSAGE : UNKNOWN_WRITE_MESSAGE);
      }
    } finally {
      if (writeController.current === controller) {
        writeLock.current = false; writeController.current = null;
        if (mounted.current) { setBusy(false); setUpdatingId(""); }
      }
    }
  }

  if (revoked) return <section className="portal-panel"><h2>Biblioteca</h2><p className="form-error" role="alert">{ACCESS_MESSAGE}</p><a className="meet-link" href="/ingresar">Iniciar sesión</a></section>;

  return <>
    {canUpload && <section className="portal-panel">
      <h2>Compartir material</h2>
      {!uploadsReady && <p role="status">La carga de archivos está pendiente de habilitación por la escuela. Puedes consultar los recursos disponibles.</p>}
      {groups.length ? <form key={scope} className="school-form event-form" onSubmit={upload}>
        <label htmlFor="library-group">Grupo</label>
        <select id="library-group" name="groupId" disabled={writesDisabled} required>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <label htmlFor="library-title">Nombre del recurso</label>
        <input id="library-title" name="title" disabled={writesDisabled} required minLength={2} maxLength={120} />
        <label htmlFor="library-category">Tipo de recurso</label>
        <select id="library-category" name="category" disabled={writesDisabled}><option>Guía</option><option>Lectura</option><option>Imagen</option><option>Audio</option><option>Actividad</option><option>Otro</option></select>
        <label htmlFor="library-file">Archivo (PDF, imagen o audio; hasta {SCHOOL_UPLOAD_LIMIT_LABEL} por archivo)</label>
        <input id="library-file" name="file" type="file" disabled={writesDisabled || !uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" required />
        <button disabled={writesDisabled || !uploadsReady}>{busy ? "Subiendo…" : "Subir y compartir"}</button>
      </form> : <p>No tienes grupos activos asignados.</p>}
    </section>}
    <section className="portal-panel">
      <h2>Recursos disponibles</h2>
      <form className={styles.filters} onSubmit={search} role="search" aria-label="Buscar recursos de la biblioteca">
        <div className={styles.field}><label htmlFor="library-search">Buscar por título o archivo</label><input id="library-search" type="search" disabled={writing} value={messageScope === scope ? draftQuery : ""} maxLength={100} placeholder="Ej. colores, canción, guía…" onChange={event => { if (!writeLock.current) setDraftQuery(event.target.value); }} /></div>
        <div className={styles.field}><label htmlFor="library-group-filter">Grupo</label><select id="library-group-filter" value={messageScope === scope ? groupFilter : ""} disabled={writing} onChange={event => changeView(() => { setGroupFilter(event.target.value); setCategoryFilter(""); setPage(1); })}><option value="">Todos mis grupos</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
        <div className={styles.field}><label htmlFor="library-category-filter">Categoría</label><select id="library-category-filter" value={messageScope === scope ? categoryFilter : ""} disabled={loading || writing} onChange={event => changeView(() => { setCategoryFilter(event.target.value); setPage(1); })}><option value="">Todas las categorías</option>{[...new Set([...categories, ...(messageScope === scope && categoryFilter ? [categoryFilter] : [])])].map(category => <option key={category} value={category}>{category}</option>)}</select></div>
        <div className={styles.searchActions}><button className="meet-link" disabled={writing} type="submit">Buscar</button><button className="secondary-button" disabled={writing} type="button" onClick={clearFilters}>Limpiar</button></div>
      </form>
      {!loading && feed && <p className={styles.summary} role="status">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total} recurso${total === 1 ? "" : "s"}` : "No hay recursos que coincidan."}</p>}
      {!loading && result.error && <p className="form-error" role="alert">{result.error}</p>}
      {messageScope === scope && error && <p className="form-error" role="alert">{error}</p>}
      {messageScope === scope && note && <p className="form-success" role="status">{note}</p>}
      {needsRead && !loading && <button className="secondary-button" type="button" disabled={writing} onClick={refresh}>Consultar recursos</button>}
      {loading ? <p role="status">Cargando recursos…</p> : items.length ? <ul className="record-list">{items.map(material => <li key={material.id}>
        <div><strong>{material.title}</strong><span>{material.category} · {material.groupName} · {material.fileName} · {Math.ceil(material.sizeBytes / 1024)} KB</span></div>
        <div className="calendar-controls">{libraryPreviewKind(material.mimeType) && <button className="secondary-button" type="button" disabled={writing || needsRead} onClick={() => openPreview(material)}>{material.mimeType.startsWith("audio/") ? "Escuchar" : "Vista previa"}</button>}<a className="meet-link" href={`/api/files/${encodeURIComponent(material.fileId)}`} download>Descargar ↓</a>{canUpload && <>
          <button className="secondary-button" type="button" aria-label={`Reemplazar archivo de ${material.title}`} disabled={writesDisabled || !uploadsReady} onClick={() => { if (!access.current || writeLock.current || readRequired.current || current.current.requestKey !== requestKey) return; replacementMaterial.current = material; replacementInput.current?.click(); }}>{updatingId === material.id ? "Procesando…" : "Reemplazar archivo"}</button>
          <button className="secondary-button" type="button" disabled={writesDisabled} onClick={() => removeMaterial(material)}>{updatingId === material.id ? "Procesando…" : "Retirar"}</button>
        </>}</div>
      </li>)}</ul> : <div className="empty-state"><p>{result.error ? "No pudimos cargar los recursos." : query || groupFilter || categoryFilter ? "No encontramos recursos con estos filtros. Prueba otra búsqueda o pulsa Limpiar." : canUpload && uploadsReady ? "Aún no hay recursos compartidos en tus grupos. Sube una guía, lectura, imagen o audio desde el formulario de arriba." : "Aún no hay recursos en tus grupos. Cuando la escuela comparta una guía, lectura, imagen o audio, aparecerá aquí."}</p>{result.error && <button className="secondary-button" type="button" onClick={refresh}>Intentar de nuevo</button>}</div>}
      {!loading && feed && totalPages > 1 && <nav className={styles.pagination} aria-label="Páginas de recursos"><button type="button" className="secondary-button" disabled={writing || page <= 1} onClick={() => changeView(() => setPage(current => current - 1))}>Anterior</button><span>Página {page} de {totalPages}</span><button type="button" className="secondary-button" disabled={writing || page >= totalPages} onClick={() => changeView(() => setPage(current => current + 1))}>Siguiente</button></nav>}

    </section>
    {!loading && feed && previewMaterial && <LibraryPreview key={previewMaterial.fileId} material={previewMaterial} onClose={() => setPreviewMaterial(null)} />}
    {canUpload && <input ref={replacementInput} aria-label="Seleccionar el archivo nuevo para reemplazar el recurso" type="file" disabled={writesDisabled || !uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" hidden onChange={event => { const material = replacementMaterial.current; replacementMaterial.current = null; if (material) void replaceFile(material, event); }} />}
  </>;
}
