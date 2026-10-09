import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import * as runtime from "react/jsx-runtime";
import postcss from "postcss";

const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const dependencies = {
  "react/jsx-runtime": runtime,
  "lucide-react": icons,
  "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
  "next/image": { __esModule: true, default: props => { const imageProps = { ...props }; delete imageProps.priority; return React.createElement("img", imageProps); } },
  "@/app/sign-out-button": { SignOutButton: () => React.createElement("button", { type: "button", className: "sign-out" }, "Cerrar sesión") },
  "@/components/notification-center": { NotificationCenter: () => React.createElement("button", { type: "button" }, "Avisos") },
  "./portal-presentation.module.css": styles,
  "@/components/portal-presentation.module.css": styles,
};
function load(sourcePath) {
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(sourcePath, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected UI dependency ${name}`), Date }), { filename: sourcePath });
  return sandboxModule.exports;
}
const { PortalShell } = load("../components/portal-shell.tsx");
dependencies["@/components/portal-shell"] = { PortalShell };
const { SupabaseDashboard } = load("../app/supabase-dashboard.tsx");
const fixture = mode => ({ mode, counts: { activeStudents: 0, activeGroups: 0, presentToday: 0, schoolYear: null, linkedChildren: 0, pendingTasks: 0, assignedGroups: 0, needsReview: 0, todayClasses: 0 }, children: [], tasks: [], events: [], announcements: [], classes: [], timeZone: "America/Mexico_City" });
const render = (mode, data = fixture(mode)) => renderToStaticMarkup(React.createElement(SupabaseDashboard, { actor: { name: "María Sintética", email: "synthetic@example.test", roles: [mode === "direccion" ? "superadmin" : mode] }, data }));

test("real dashboard preserves zero metrics, institutional logo and accessible active navigation", () => {
  const html = render("direccion");
  assert.match(html, /Tu escuela, a un vistazo\./);
  assert.equal((html.match(/<strong>0<\/strong>/g) ?? []).length, 3);
  assert.match(html, /Sin configurar/);
  assert.match(html, /src="\/logo-escuela\.jpg"/);
  assert.match(html, /href="\/" aria-current="page"/);
  assert.match(html, /Saltar al contenido principal/);
  assert.match(html, /id="contenido" tabindex="-1"/);
  assert.doesNotMatch(html, /synthetic@example\.test/);
});

test("real quick links follow existing role capabilities and never expose administration to families or students", () => {
  for (const [mode, expected] of [["direccion", ["/grupos", "/alumnos", "/cuentas"]], ["docente", ["/tareas", "/clases", "/biblioteca"]], ["tutor", ["/tareas", "/calendario", "/seguimiento"]], ["alumno", ["/actividades", "/biblioteca", "/calendario"]]]) {
    const html = render(mode);
    const nav = /<nav class="shortcuts" aria-label="Accesos rápidos">([\s\S]*?)<\/nav>/.exec(html)?.[1];
    assert.ok(nav);
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), expected);
    if (mode !== "direccion") assert.doesNotMatch(html, /href="\/(cuentas|grupos|sistema|auditoria)"/);
  }
});

test("greeting uses human first names and falls back by role for identifiers or email", () => {
  for (const [name, mode, expected] of [["María Sintética", "tutor", "¡Hola, María!"], ["elmundodelosnilos10", "direccion", "¡Hola, equipo escolar!"], ["synthetic@example.test", "tutor", "¡Hola, familia!"], ["Unidentificadordemasiadolargoparasaludar", "docente", "¡Hola, equipo docente!"], ["El Mundo de los Niños", "direccion", "¡Hola, equipo escolar!"]]) {
    const html = renderToStaticMarkup(React.createElement(SupabaseDashboard, { actor: { name, email: "synthetic@example.test", roles: [mode] }, data: fixture(mode) }));
    assert.ok(html.includes(`<p class="greeting">${expected}</p>`));
    if (name.includes("@")) assert.doesNotMatch(html, /synthetic@example\.test/);
  }
  const noCapability = renderToStaticMarkup(React.createElement(SupabaseDashboard, { actor: { name: "Familia sintética", email: "synthetic@example.test", roles: ["tutor"] }, data: fixture("direccion") }));
  assert.doesNotMatch(noCapability, /href="\/(cuentas|grupos|alumnos)"/);
  assert.doesNotMatch(noCapability, /Una escuela lista para crecer/);
});

test("real empty family dashboard explains linking and pending content with usable section links", () => {
  const html = render("tutor");
  assert.match(html, /Aquí acompañarás a tus niños/);
  assert.match(html, /Solicita el vínculo a la escuela/);
  assert.match(html, /Sin tareas pendientes/);
  assert.match(html, /Consultar tareas/);
  assert.match(html, /Consultar calendario/);
  assert.match(html, /Consultar comunicados/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("real populated dashboard retains child detail, task data and Mexico City dates", () => {
  const data = fixture("tutor");
  data.children = [{ id: "synthetic-child", givenName: "Niño", familyName: "Sintético", groupId: "group", groupName: "Grupo sintético" }];
  data.tasks = [{ id: "task", title: "Tarea sintética", dueAt: "2026-10-10T13:00:00Z" }];
  data.events = [{ id: "event", title: "Evento sintético", startsAt: "2026-10-10T13:00:00Z" }];
  const html = render("tutor", data);
  assert.match(html, /href="\/alumnos\/synthetic-child"/);
  assert.match(html, /Tarea sintética/);
  assert.match(html, /7:00:00/);
  assert.match(html, /Evento sintético/);
  assert.doesNotMatch(html, /Aquí acompañarás a tus niños|Sin tareas pendientes|Una agenda por descubrir/);
});

test("school navigation retains role permissions and a single current page beyond home", () => {
  const html = renderToStaticMarkup(React.createElement(PortalShell, { name: "Docente sintética", role: "docente", active: "/seguimiento" }, React.createElement("h1", null, "Contenido sintético")));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/seguimiento" aria-current="page"/);
  assert.match(html, /aria-label="Ubicación actual"/);
  assert.doesNotMatch(html, /href="\/cuentas"/);
});

test("presentation CSS parses and explicitly preserves two-column mobile metrics,44px actions and reduced motion", () => {
  const css = readFileSync(new URL("../components/portal-presentation.module.css", import.meta.url), "utf8");
  assert.doesNotThrow(() => postcss.parse(css));
  assert.match(css, /\.dashboard \.metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.panelLink[^}]*min-height: 44px/s);
  assert.match(css, /\.topbarActions button \{ min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
