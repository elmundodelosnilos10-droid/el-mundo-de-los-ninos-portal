"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { interactiveActivities, stageLabels, type SchoolStage } from "./catalog";

type SchoolChild = { id: string; name: string; groupName: string; stage: SchoolStage };
type SavedActivity = { activityId: string; completedAt: string; artwork: Stroke[] | null };
type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[] };
const palette = [
  { value: "#237345", label: "Verde" },
  { value: "#ffb629", label: "Amarillo" },
  { value: "#ed6b68", label: "Coral" },
  { value: "#4285d4", label: "Azul" },
  { value: "#8659ad", label: "Morado" },
  { value: "#293c30", label: "Gris oscuro" },
];

export function ActivityLibrary({ students, canPlay }: { students: SchoolChild[]; canPlay: boolean }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [completed, setCompleted] = useState<SavedActivity[]>([]);
  const [loadedStudentId, setLoadedStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(interactiveActivities[0]?.id ?? "");
  const [drawing, setDrawing] = useState<Stroke[]>([]);
  const [color, setColor] = useState(palette[0].value);
  const svgRef = useRef<SVGSVGElement>(null);
  const savePending = useRef(false);
  const saveRevision = useRef(0);
  const progressStudent = useRef("");
  const mounted = useRef(true);
  const currentContext = useRef({ studentId: "", activityId: "", canPlay });
  const child = students.find(item => item.id === studentId);
  const available = useMemo(() => interactiveActivities.filter(item => child && item.stages.includes(child.stage)), [child]);
  const activity = available.find(item => item.id === selectedId) ?? available[0];
  useLayoutEffect(() => { currentContext.current = { studentId: child?.id ?? "", activityId: activity?.id ?? "", canPlay }; }, [child?.id, activity?.id, canPlay]);
  const visibleCompleted = loadedStudentId === studentId ? completed : [];
  const doneIds = new Set(visibleCompleted.map(item => item.activityId));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    const revision = saveRevision.current;
    const current = () => live && mounted.current && currentContext.current.studentId === studentId;
    if (!studentId) return;
    fetch(`/api/activity-progress?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ items?: SavedActivity[] }>; })
      .then(data => {
        if (!current()) return;
        const incoming = Array.isArray(data.items) ? data.items : [];
        const preserveConfirmed = saveRevision.current !== revision && progressStudent.current === studentId;
        progressStudent.current = studentId;
        setCompleted(items => {
          if (!preserveConfirmed) return incoming;
          const confirmed = new Set(items.map(item => item.activityId));
          return [...items, ...incoming.filter(item => !confirmed.has(item.activityId))];
        });
        setLoadedStudentId(studentId);
      })
      .catch(() => { if (current() && saveRevision.current === revision) setMessage("No pudimos cargar los logros ahora. Vuelve a intentarlo."); });
    return () => { live = false; };
  }, [studentId]);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) { setMessage("Este dispositivo no tiene lectura de voz disponible."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US"; utterance.rate = 0.78; window.speechSynthesis.speak(utterance);
  }
  async function save(answer?: string, artwork?: Stroke[]) {
    if (!child || !activity || !canPlay || savePending.current) return;
    const target = { studentId: child.id, activityId: activity.id };
    const current = () => mounted.current && currentContext.current.canPlay && currentContext.current.studentId === target.studentId && currentContext.current.activityId === target.activityId;
    savePending.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/activity-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: child.id, activityId: activity.id, ...(answer ? { answer } : {}), ...(artwork ? { artwork } : {}) }) });
      const data = await response.json().catch(() => ({})) as { error?: string; completedAt?: string };
      if (!current()) return;
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el logro.");
      if (!data.completedAt) throw new Error("No pudimos confirmar que se guardó el logro.");
      const completedAt = data.completedAt;
      const sameStudent = progressStudent.current === target.studentId;
      progressStudent.current = target.studentId; saveRevision.current++;
      setCompleted(items => [{ activityId: target.activityId, completedAt, artwork: artwork ?? null }, ...(sameStudent ? items : []).filter(item => item.activityId !== target.activityId)]);
      setLoadedStudentId(target.studentId);
      setMessage("¡Logro guardado! Pueden volver a jugar cuando quieran.");
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "No se pudo guardar. Inténtenlo de nuevo."); }
    finally { savePending.current = false; if (mounted.current) setBusy(false); }
  }
  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function startDrawing(event: React.PointerEvent<SVGSVGElement>) {
    if (!canPlay || savePending.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(current => [...current, { color, points: [pointFromEvent(event)] }]);
  }
  function moveDrawing(event: React.PointerEvent<SVGSVGElement>) {
    if (!canPlay || savePending.current || !(event.buttons & 1)) return;
    const point = pointFromEvent(event);
    setDrawing(current => current.map((stroke, index) => index === current.length - 1 ? { ...stroke, points: [...stroke.points, point] } : stroke));
  }

  if (!students.length) return <section className="portal-panel"><h2>Pronto habrá actividades</h2><p>Cuando la escuela vincule un alumno a esta cuenta y a su grupo, aquí aparecerán retos adecuados a su etapa.</p></section>;
  return <>
    <section className="portal-panel activity-child-panel">
      <label htmlFor="activity-student">¿Para quién vamos a jugar?</label>
      <select id="activity-student" value={studentId} disabled={busy} onChange={event => { if (savePending.current) return; setStudentId(event.target.value); setMessage(""); setDrawing([]); }}>{students.map(item => <option key={`${item.id}:${item.groupName}`} value={item.id}>{item.name} · {item.groupName}</option>)}</select>
      {child && <p className="activity-stage">{stageLabels[child.stage]} · {visibleCompleted.length} de {available.length} logros</p>}
    </section>
    {child && <div className="activity-layout">
      <nav className="activity-list" aria-label="Actividades disponibles">{available.map(item => <button type="button" key={item.id} className={activity?.id === item.id ? "active" : ""} aria-pressed={activity?.id === item.id} disabled={busy} onClick={() => { if (savePending.current) return; setSelectedId(item.id); setDrawing([]); setMessage(""); }}><span aria-hidden="true">{item.kind === "drawing" ? "🎨" : item.area.startsWith("Lenguajes") ? "🔤" : item.area.startsWith("Saberes") ? "🔎" : item.area.startsWith("Ética") ? "🌿" : "🤝"}</span><span><strong>{item.title}</strong><small>{item.area}</small></span>{doneIds.has(item.id) && <span className="activity-check" aria-label="Completada">✓</span>}</button>)}</nav>
      {activity && <section className="portal-panel activity-card">
        <div className="activity-heading"><div><span className="eyebrow">{activity.area.toUpperCase()}</span><h2>{activity.title}</h2></div><span className="activity-age">{activity.ageLabel}</span></div>
        <p className="activity-prompt">{activity.prompt}</p>
        {activity.id === "semillas-contar" && <figure className="activity-seed-stimulus">
          <svg viewBox="0 0 260 180" role="img" aria-label="Una maceta con tres semillas">
            <title>Una maceta con tres semillas</title>
            <path d="M55 79h150l-19 79H74Z" fill="#bb6946" />
            <path d="M55 79h150l-4 17H59Z" fill="#ce8059" />
            <ellipse cx="130" cy="77" rx="78" ry="27" fill="#e4a178" />
            <ellipse cx="130" cy="77" rx="65" ry="19" fill="#624436" />
            <ellipse data-seed="true" cx="95" cy="75" rx="11" ry="7" transform="rotate(-20 95 75)" fill="#f7df9b" />
            <ellipse data-seed="true" cx="130" cy="81" rx="11" ry="7" transform="rotate(15 130 81)" fill="#f7df9b" />
            <ellipse data-seed="true" cx="165" cy="73" rx="11" ry="7" transform="rotate(-15 165 73)" fill="#f7df9b" />
          </svg>
          <figcaption>Observa la maceta y cuenta sus semillas.</figcaption>
        </figure>}
        {activity.kind === "choice" ? <>
          {activity.speakText && <button type="button" className="activity-speak" onClick={() => speak(activity.speakText!)}>🔊 Escuchar en inglés</button>}
          <div className="activity-options">{activity.options.map(option => <button key={option.value} type="button" disabled={!canPlay || busy} onClick={() => void save(option.value)}><span aria-hidden="true">{option.symbol}</span>{option.label}</button>)}</div>
        </> : <>
          <svg ref={svgRef} className="activity-canvas" viewBox="0 0 1000 420" role="img" aria-label="Área para dibujar el huerto" onPointerDown={startDrawing} onPointerMove={moveDrawing} onPointerUp={() => {}}>
            <rect width="1000" height="420" rx="24" fill="#fbfcf6" />
            {(drawing.length ? drawing : (visibleCompleted.find(item => item.activityId === activity.id)?.artwork ?? [])).map((stroke, index) => stroke.points.length > 1 ? <polyline key={index} points={stroke.points.map(point => `${point.x * 1000},${point.y * 420}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /> : null)}
            {drawing.length === 0 && <text x="500" y="220" textAnchor="middle" fill="#809183" fontSize="27">Dibuja aquí con el dedo o el mouse</text>}
          </svg>
          <div className="activity-drawing-tools"><div role="group" aria-label="Color del lápiz">{palette.map(item => <button type="button" key={item.value} aria-label={`Elegir color ${item.label.toLowerCase()}`} aria-pressed={color === item.value} title={item.label} className={color === item.value ? "chosen" : ""} style={{ backgroundColor: item.value }} onClick={() => setColor(item.value)} />)}</div><button type="button" className="button-secondary" onClick={() => setDrawing([])}>Borrar dibujo</button><button type="button" className="button-primary" disabled={!canPlay || busy || !drawing.length} onClick={() => void save(undefined, drawing)}>Guardar dibujo</button></div>
        </>}
        <aside className="activity-hint"><strong>Idea para acompañar:</strong> {activity.hint}</aside>
        {!canPlay && <p className="activity-readonly">Puedes consultar los logros; la actividad se guarda desde la cuenta familiar.</p>}
        {message && <p className={message.startsWith("¡") ? "form-success" : "form-error"} role="status">{message}</p>}
      </section>}
    </div>}
  </>;
}
