// Synthetic presentation fixture only; no student records or production services.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sandboxModule = { exports: {} };
const source = fs.readFileSync(new URL("../lib/attendance-export.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { module: sandboxModule, exports: sandboxModule.exports, require, TextEncoder, Uint8Array });
const rows = [
  ["Fecha", "Grupo", "Alumno", "Estado", "Observación"],
  ["2026-10-02", "Preescolar verde", "María Fernanda del Carmen Rodríguez Hernández - ejemplo sintético", "justificada por enfermedad familiar", "La familia entregó una observación completa. Primera línea.\n\nSegunda línea con información de apoyo y seguimiento para cuando regrese a clases."],
  ["2026-10-03", "Preescolar azul", "José Ángel de los Santos Pérez - ejemplo sintético", "presente", "Participó con entusiasmo en las actividades de lectura y juegos. Se recomienda continuar con las actividades en casa. 😀 (carácter fuera de la fuente del PDF)"],
  ["2026-10-04", "Preescolar coral", "Ana Ejemplo - observación extensa", "presente", Array.from({ length: 55 }, (_, index) => `Paso ${String(index + 1).padStart(2, "0")}: actividad sintética de asistencia y apoyo.`).join("\n")],
  ...Array.from({ length: 8 }, (_, index) => ["2026-10-05", index % 2 ? "Preescolar verde" : "Preescolar azul", `Alumno de ejemplo ${index + 1} - datos sintéticos`, index % 2 ? "retardo" : "presente", "La observación conserva todas sus palabras. Este registro permite revisar los márgenes, las columnas y la continuidad entre páginas."]),
];
const output = new URL("../output/pdf/asistencia-ejemplo-sintetico.pdf", import.meta.url);
fs.mkdirSync(new URL("../output/pdf/", import.meta.url), { recursive: true });
fs.writeFileSync(output, sandboxModule.exports.buildAttendancePdf("Todos los grupos - DATOS SINTÉTICOS", "2026-10-01", "2026-10-08", rows));
console.log(output.pathname);
