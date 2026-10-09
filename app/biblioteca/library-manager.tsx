"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { libraryListUrl, libraryPreviewKind, type LibraryFeed, type LibraryMaterial } from "@/lib/library-query";
import { readSchoolUploadResponse, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE } from "@/lib/school-upload-limits";
import { LibraryPreview } from "./library-preview";
import styles from "./library.module.css";

type Group = { id: string; name: string };
type Material = LibraryMaterial;
type ApiResult = Partial<LibraryFeed> & { error?: string; name?: string };

export function LibraryManager({ groups, canUpload, uploadsReady = false }: { groups: Group[]; canUpload: boolean; uploadsReady?: boolean }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; feed: LibraryFeed | null; error: string }>({ key: "", feed: null, error: "" });
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const pageSize = 12;
  const listUrl = libraryListUrl({ query, groupId: groupFilter || null, category: categoryFilter || null, page, pageSize });
  const requestKey = `${listUrl}:${revision}`;
  const loading = result.key !== requestKey;
  const feed = loading ? null : result.feed;
  const items = feed?.items ?? [];
  const total = feed?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const categories = result.feed?.categories ?? [];
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacementMaterial = useRef<Material | null>(null);

  function refresh() { setRevision(current => current + 1); }

  useEffect(() => {
    const controller = new AbortController();
    fetch(listUrl, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as ApiResult;
      if (!response.ok) throw Error(data.error || "No se cargaron los materiales.");
      if (!Array.isArray(data.items) || !Array.isArray(data.categories) || !Number.isSafeInteger(data.total)) throw Error("No se pudo confirmar la lista de materiales.");
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(Number(data.total) / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setResult({ key: requestKey, feed: data as LibraryFeed, error: "" });
    }).catch(reason => {
      if (!controller.signal.aborted) setResult({ key: requestKey, feed: null, error: reason instanceof Error ? reason.message : "No se cargaron los materiales." });
    });
    return () => controller.abort();
  }, [listUrl, requestKey, page]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setQuery(draftQuery.trim()); setPage(1); setError(""); setPreviewMaterial(null); refresh();
  }
  function clearFilters() {
    setDraftQuery(""); setQuery(""); setGroupFilter(""); setCategoryFilter(""); setPage(1); setError(""); setPreviewMaterial(null); refresh();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    const form = event.currentTarget;
    const data = new FormData(form); data.set("purpose", "material");
    const file = data.get("file");
    if (file instanceof File && file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const response = await fetch("/api/files", { method: "POST", body: data });
      const result = await readSchoolUploadResponse(response) as ApiResult;
      if (!response.ok) throw Error(result.error || "No se pudo subir el material.");
      refresh(); form.reset(); setNote("Material publicado para el grupo.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function replaceFile(material: Material, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    if (file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    const data = new FormData(); data.set("file", file);
    setUpdatingId(material.id); setError(""); setNote("");
    try {
      const response = await fetch(`/api/materials/${material.id}/replace`, { method: "POST", body: data });
      const result = await readSchoolUploadResponse(response) as ApiResult;
      if (!response.ok) throw Error(result.error || "No se pudo reemplazar el archivo.");
      setPreviewMaterial(null); refresh(); setNote(`Se reemplazó el archivo de “${material.title}”.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error de conexión."); }
    finally { setUpdatingId(""); }
  }

  async function removeMaterial(material: Material) {
    if (!window.confirm(`¿Retirar “${material.title}” de la biblioteca? Las familias ya no podrán abrir ni descargar este archivo.`)) return;
    setUpdatingId(material.id); setError(""); setNote("");
    try {
      const response = await fetch(`/api/materials/${material.id}`, { method: "DELETE" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw Error(result.error || "No se pudo retirar el recurso.");
      setPreviewMaterial(null); refresh(); setNote(`Se retiró “${material.title}” de la biblioteca.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error de conexión."); }
    finally { setUpdatingId(""); }
  }

  return <>
    {canUpload && <section className="portal-panel">
      <h2>Compartir material</h2>
      {!uploadsReady && <p role="status">La carga de archivos está pendiente de habilitación por la escuela. Puedes consultar los recursos disponibles.</p>}
      {groups.length ? <form className="school-form event-form" onSubmit={upload}>
        <label htmlFor="library-group">Grupo</label>
        <select id="library-group" name="groupId" required>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <label htmlFor="library-title">Nombre del recurso</label>
        <input id="library-title" name="title" required minLength={2} maxLength={120} />
        <label htmlFor="library-category">Tipo de recurso</label>
        <select id="library-category" name="category"><option>Guía</option><option>Lectura</option><option>Imagen</option><option>Audio</option><option>Actividad</option><option>Otro</option></select>
        <label htmlFor="library-file">Archivo (PDF, imagen o audio; hasta {SCHOOL_UPLOAD_LIMIT_LABEL} por archivo)</label>
        <input id="library-file" name="file" type="file" disabled={!uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" required />
        <button disabled={busy || !uploadsReady}>{busy ? "Subiendo…" : "Subir y compartir"}</button>
      </form> : <p>No tienes grupos activos asignados.</p>}
    </section>}
    <section className="portal-panel">
      <h2>Recursos disponibles</h2>
      <form className={styles.filters} onSubmit={search} role="search" aria-label="Buscar recursos de la biblioteca">
        <div className={styles.field}><label htmlFor="library-search">Buscar por título o archivo</label><input id="library-search" type="search" value={draftQuery} maxLength={100} placeholder="Ej. colores, canción, guía…" onChange={event => setDraftQuery(event.target.value)} /></div>
        <div className={styles.field}><label htmlFor="library-group-filter">Grupo</label><select id="library-group-filter" value={groupFilter} onChange={event => { setGroupFilter(event.target.value); setCategoryFilter(""); setPage(1); setError(""); setPreviewMaterial(null); }}><option value="">Todos mis grupos</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
        <div className={styles.field}><label htmlFor="library-category-filter">Categoría</label><select id="library-category-filter" value={categoryFilter} disabled={loading} onChange={event => { setCategoryFilter(event.target.value); setPage(1); setError(""); setPreviewMaterial(null); }}><option value="">Todas las categorías</option>{[...new Set([...categories, ...(categoryFilter ? [categoryFilter] : [])])].map(category => <option key={category} value={category}>{category}</option>)}</select></div>
        <div className={styles.searchActions}><button className="meet-link" type="submit">Buscar</button><button className="secondary-button" type="button" onClick={clearFilters}>Limpiar</button></div>
      </form>
      {!loading && feed && <p className={styles.summary} role="status">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total} recurso${total === 1 ? "" : "s"}` : "No hay recursos que coincidan."}</p>}
      {!loading && result.error && <p className="form-error" role="alert">{result.error}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {note && <p className="form-success" role="status">{note}</p>}
      {loading ? <p role="status">Cargando recursos…</p> : items.length ? <ul className="record-list">{items.map(material => <li key={material.id}>
        <div><strong>{material.title}</strong><span>{material.category} · {material.groupName} · {material.fileName} · {Math.ceil(material.sizeBytes / 1024)} KB</span></div>
        <div className="calendar-controls">{libraryPreviewKind(material.mimeType) && <button className="secondary-button" type="button" onClick={() => setPreviewMaterial(material)}>{material.mimeType.startsWith("audio/") ? "Escuchar" : "Vista previa"}</button>}<a className="meet-link" href={`/api/files/${encodeURIComponent(material.fileId)}`} download>Descargar ↓</a>{canUpload && <>
          <button className="secondary-button" type="button" aria-label={`Reemplazar archivo de ${material.title}`} disabled={Boolean(updatingId) || !uploadsReady} onClick={() => { replacementMaterial.current = material; replacementInput.current?.click(); }}>{updatingId === material.id ? "Procesando…" : "Reemplazar archivo"}</button>
          <button className="secondary-button" type="button" disabled={Boolean(updatingId)} onClick={() => removeMaterial(material)}>{updatingId === material.id ? "Procesando…" : "Retirar"}</button>
        </>}</div>
      </li>)}</ul> : <div className="empty-state"><p>{result.error ? "No pudimos cargar los recursos." : query || groupFilter || categoryFilter ? "No encontramos recursos con estos filtros. Prueba otra búsqueda o pulsa Limpiar." : canUpload && uploadsReady ? "Aún no hay recursos compartidos en tus grupos. Sube una guía, lectura, imagen o audio desde el formulario de arriba." : "Aún no hay recursos en tus grupos. Cuando la escuela comparta una guía, lectura, imagen o audio, aparecerá aquí."}</p>{result.error && <button className="secondary-button" type="button" onClick={refresh}>Intentar de nuevo</button>}</div>}
      {!loading && feed && totalPages > 1 && <nav className={styles.pagination} aria-label="Páginas de recursos"><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => { setPage(current => current - 1); setPreviewMaterial(null); }}>Anterior</button><span>Página {page} de {totalPages}</span><button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => { setPage(current => current + 1); setPreviewMaterial(null); }}>Siguiente</button></nav>}

    </section>
    {previewMaterial && <LibraryPreview key={previewMaterial.fileId} material={previewMaterial} onClose={() => setPreviewMaterial(null)} />}
    {canUpload && <input ref={replacementInput} aria-label="Seleccionar el archivo nuevo para reemplazar el recurso" type="file" disabled={!uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" hidden onChange={event => { const material = replacementMaterial.current; replacementMaterial.current = null; if (material) void replaceFile(material, event); }} />}
  </>;
}
