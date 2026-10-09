"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { interactiveActivities, stageLabels, type SchoolStage } from "./catalog";

type SchoolChild = { id: string; name: string; groupName: string; stage: SchoolStage };
type SavedActivity = { activityId: string; completedAt: string; artwork: Stroke[] | null };
type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[] };
const palette = ["#237345", "#ffb629", "#ed6b68", "#4285d4", "#8659ad", "#293c30"];

export function ActivityLibrary({ students, canPlay }: { students: SchoolChild[]; canPlay: boolean }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [completed, setCompleted] = useState<SavedActivity[]>([]);
  const [loadedStudentId, setLoadedStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(interactiveActivities[0]?.id ?? "");
  const [drawing, setDrawing] = useState<Stroke[]>([]);
  const [color, setColor] = useState(palette[0]);
  const svgRef = useRef<SVGSVGElement>(null);
  const child = students.find(item => item.id === studentId);
  const available = useMemo(() => interactiveActivities.filter(item => child && item.stages.includes(child.stage)), [child]);
  const activity = available.find(item => item.id === selectedId) ?? available[0];
  const visibleCompleted = loadedStudentId === studentId ? completed : [];
  const doneIds = new Set(visibleCompleted.map(item => item.activityId));

  useEffect(() => {
    let live = true;
    if (!studentId) return;
    fetch(`/api/activity-progress?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ items?: SavedActivity[] }>; })
      .then(data => { if (live) { setCompleted(Array.isArray(data.items) ? data.items : []); setLoadedStudentId(studentId); } })
      .catch(() => { if (live) setMessage("No pudimos cargar los logros ahora. Vuelve a intentarlo."); });
    return () => { live = false; };
  }, [studentId]);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) { setMessage("Este dispositivo no tiene lectura de voz disponible."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US"; utterance.rate = 0.78; window.speechSynthesis.speak(utterance);
  }
  async function save(answer?: string, artwork?: Stroke[]) {
    if (!child || !activity) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/activity-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: child.id, activityId: activity.id, ...(answer ? { answer } : {}), ...(artwork ? { artwork } : {}) }) });
      const data = await response.json().catch(() => ({})) as { error?: string; completedAt?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el logro.");
      if (!data.completedAt) throw new Error("No pudimos confirmar que se guardó el logro.");
      const completedAt = data.completedAt;
      setCompleted(current => [{ activityId: activity.id, completedAt, artwork: artwork ?? null }, ...current.filter(item => item.activityId !== activity.id)]);
      setMessage("¡Logro guardado! Pueden volver a jugar cuando quieran.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar. Inténtenlo de nuevo."); }
    finally { setBusy(false); }
  }
  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function startDrawing(event: React.PointerEvent<SVGSVGElement>) {
    if (!canPlay) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(current => [...current, { color, points: [pointFromEvent(event)] }]);
  }
  function moveDrawing(event: React.PointerEvent<SVGSVGElement>) {
    if (!(event.buttons & 1)) return;
    const point = pointFromEvent(event);
    setDrawing(current => current.map((stroke, index) => index === current.length - 1 ? { ...stroke, points: [...stroke.points, point] } : stroke));
  }

  if (!students.length) return <section className="portal-panel"><h2>Pronto habrá actividades</h2><p>Cuando la escuela vincule un alumno a esta cuenta y a su grupo, aquí aparecerán retos adecuados a su etapa.</p></section>;
  return <>
    <section className="portal-panel activity-child-panel">
      <label htmlFor="activity-student">¿Para quién vamos a jugar?</label>
      <select id="activity-student" value={studentId} onChange={event => { setStudentId(event.target.value); setMessage(""); setDrawing([]); }}>{students.map(item => <option key={`${item.id}:${item.groupName}`} value={item.id}>{item.name} · {item.groupName}</option>)}</select>
      {child && <p className="activity-stage">{stageLabels[child.stage]} · {visibleCompleted.length} de {available.length} logros</p>}
    </section>
    {child && <div className="activity-layout">
      <nav className="activity-list" aria-label="Actividades disponibles">{available.map(item => <button type="button" key={item.id} className={activity?.id === item.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setDrawing([]); setMessage(""); }}><span aria-hidden="true">{item.kind === "drawing" ? "🎨" : item.area.startsWith("Lenguajes") ? "🔤" : item.area.startsWith("Saberes") ? "🔎" : item.area.startsWith("Ética") ? "🌿" : "🤝"}</span><span><strong>{item.title}</strong><small>{item.area}</small></span>{doneIds.has(item.id) && <span className="activity-check" aria-label="Completada">✓</span>}</button>)}</nav>
      {activity && <section className="portal-panel activity-card">
        <div className="activity-heading"><div><span className="eyebrow">{activity.area.toUpperCase()}</span><h2>{activity.title}</h2></div><span className="activity-age">{activity.ageLabel}</span></div>
        <p className="activity-prompt">{activity.prompt}</p>
        {activity.kind === "choice" ? <>
          {activity.speakText && <button type="button" className="activity-speak" onClick={() => speak(activity.speakText!)}>🔊 Escuchar en inglés</button>}
          <div className="activity-options">{activity.options.map(option => <button key={option.value} type="button" disabled={!canPlay || busy} onClick={() => void save(option.value)}><span aria-hidden="true">{option.symbol}</span>{option.label}</button>)}</div>
        </> : <>
          <svg ref={svgRef} className="activity-canvas" viewBox="0 0 1000 420" role="img" aria-label="Área para dibujar el huerto" onPointerDown={startDrawing} onPointerMove={moveDrawing} onPointerUp={() => {}}>
            <rect width="1000" height="420" rx="24" fill="#fbfcf6" />
            {(drawing.length ? drawing : (visibleCompleted.find(item => item.activityId === activity.id)?.artwork ?? [])).map((stroke, index) => stroke.points.length > 1 ? <polyline key={index} points={stroke.points.map(point => `${point.x * 1000},${point.y * 420}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /> : null)}
            {drawing.length === 0 && <text x="500" y="220" textAnchor="middle" fill="#809183" fontSize="27">Dibuja aquí con el dedo o el mouse</text>}
          </svg>
          <div className="activity-drawing-tools"><div aria-label="Color del lápiz">{palette.map(item => <button type="button" key={item} aria-label={`Elegir color ${item}`} className={color === item ? "chosen" : ""} style={{ backgroundColor: item }} onClick={() => setColor(item)} />)}</div><button type="button" className="button-secondary" onClick={() => setDrawing([])}>Borrar dibujo</button><button type="button" className="button-primary" disabled={!canPlay || busy || !drawing.length} onClick={() => void save(undefined, drawing)}>Guardar dibujo</button></div>
        </>}
        <aside className="activity-hint"><strong>Idea para acompañar:</strong> {activity.hint}</aside>
        {!canPlay && <p className="activity-readonly">Puedes consultar los logros; la actividad se guarda desde la cuenta familiar.</p>}
        {message && <p className={message.startsWith("¡") ? "form-success" : "form-error"} role="status">{message}</p>}
      </section>}
    </div>}
  </>;
}
