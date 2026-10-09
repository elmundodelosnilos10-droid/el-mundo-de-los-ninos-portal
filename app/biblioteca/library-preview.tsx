"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { LibraryMaterial } from "@/lib/library-query";
import { libraryPreviewKind } from "@/lib/library-query";
import { loadPrivateLibraryPreview } from "@/lib/library-preview";
import styles from "./library.module.css";

export function LibraryPreview({ material, onClose }: { material: LibraryMaterial; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ url: string; error: string }>({ url: "", error: "" });
  const kind = libraryPreviewKind(material.mimeType);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Removal clears the native top layer. Closing during Strict Mode effect
    // cleanup would emit onClose and dismiss a newly opened preview.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    loadPrivateLibraryPreview(material.fileId, material.mimeType, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPreview({ url: objectUrl, error: "" });
    }).catch(cause => {
      if (!controller.signal.aborted) setPreview({ url: "", error: cause instanceof Error ? cause.message : "No se pudo abrir el recurso." });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [material.fileId, material.mimeType]);

  return <dialog ref={dialog} className={styles.previewDialog} aria-labelledby="library-preview-title" onClose={onClose}>
    <div className={styles.previewHeading}><div><p className="eyebrow">VISTA PREVIA PRIVADA</p><h2 id="library-preview-title">{material.title}</h2><p>{material.fileName} · {material.groupName}</p></div>
      <button type="button" className="secondary-button" onClick={() => dialog.current?.close()} aria-label="Cerrar vista previa">Cerrar ✕</button></div>
    {preview.error ? <p className="form-error" role="alert">{preview.error}</p> : !preview.url ? <p role="status">Abriendo recurso…</p> : <div className={styles.previewBody}>
      {kind === "pdf" && <object type="application/pdf" data={preview.url} className={styles.pdfPreview} aria-label={`PDF: ${material.title}`}><p>Tu navegador no puede mostrar este PDF aquí. Usa el botón Descargar para abrirlo.</p></object>}
      {kind === "image" && <Image unoptimized src={preview.url} alt={material.title} width={1000} height={750} className={styles.imagePreview} onError={() => setPreview({ url: "", error: "La imagen no se pudo mostrar. Puedes descargarla para abrirla." })} />}
      {kind === "audio" && <audio controls preload="metadata" src={preview.url} className={styles.audioPreview}>Tu navegador no puede reproducir este audio.</audio>}
    </div>}
    <div className={styles.previewFooter}><a className="meet-link" href={`/api/files/${encodeURIComponent(material.fileId)}`} download>Descargar ↓</a><p>Si tu navegador no muestra el archivo, puedes descargarlo y abrirlo en tu dispositivo.</p></div>
  </dialog>;
}
